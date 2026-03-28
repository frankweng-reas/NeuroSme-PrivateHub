"""
Intent v3.2 → DuckDB SQL。

**規範 SSOT**：`docs/intent_v3.2_protocol.md`（與本實作對齊；LLM 提示詞見 `config/system_prompt_analysis_intent_tool.md`）。

結構（calculate 模式）：
- **Atomic metrics**：`formula` 為單一聚合包一欄（SUM／AVG／COUNT／MIN／MAX），各占一個 CTE。
- **Derived metrics**：`formula` 僅含 m1、m2… 與運算，不生成 CTE；扁平衍生與 **`merge_sql` 合併於同一 `SELECT … FROM (merge) AS mrg`** 後，**`SELECT * FROM (該段) AS v0`**；鏈式衍生則在 **v0 內層** 巢狀展開（見 `_build_calculate_sql`）。
- **第一段**：`WITH` 內各原子 CTE；**第二段** **`merge_sql`**：`COALESCE(t0._g{i}, t1._g{i}, …) AS dim_{i}` + 各側原子欄（**單一原子時仍使用 COALESCE(t0._g{i}, …) 形式**以利擴充）。
- **第二階段（單一 v0）**：主查詢一律為 **`SELECT * FROM ( inner ) AS v0`**（**禁止** `FROM ((…))` 雙層括號）。`inner` 無衍生時等於 **`merge_sql`**；有扁平衍生時為 **`SELECT … FROM (merge_sql) AS mrg`**（CAST 使用 **`mrg`** 限定）；鏈式衍生則於 `inner` 內巢狀展開。
- **`post_process`**：掛在主查詢上，用 **`v0.<欄位>`**（或與引擎一致之限定方式）。
- **時間**：`TRY_CAST(col AS DATE)` 為 DuckDB 支援語法；`WHERE`／`GROUP BY` 與 `_group_expr_sql` 產物與原子 CTE `SELECT`／`GROUP BY` 對齊（見 `_atomic_cte_group_select_and_groupby`）。
"""
from __future__ import annotations

import re
from collections import defaultdict, deque
from typing import Any

from app.schemas.intent_v32 import FilterClauseV32, IntentV32, MetricV32
from app.services.compute_engine_sql import (
    _dataset_label_for_formula_alias,
    _sql_ident,
    column_allowlist_from_schema,
)
from app.services.compute_engine_sql_v2 import _schema_column_type_lower, _sql_literal, _time_filter_lhs_sql

_GROUP_FN = re.compile(
    r"^\s*([A-Za-z_][a-zA-Z0-9_]*)\s*\(\s*(col_[a-zA-Z0-9_]+)\s*\)\s*$",
    re.IGNORECASE,
)
_ATOMIC_AGG = re.compile(
    r"^\s*([A-Za-z_][a-zA-Z0-9_]*)\s*\(\s*(col_[a-zA-Z0-9_]+)\s*\)\s*$",
    re.IGNORECASE,
)
_METRIC_REF = re.compile(r"\bm\d+\b", re.IGNORECASE)

_ALLOWED_GROUP_FN = frozenset({"MONTH", "YEAR", "QUARTER"})
_ALLOWED_ATOMIC_AGG = frozenset({"SUM", "AVG", "COUNT", "MIN", "MAX"})


def _filter_clause_sql(
    f: FilterClauseV32,
    schema_def: dict[str, Any] | None,
    *,
    table_alias: str | None = None,
) -> str | None:
    c0 = f.col.strip()
    is_time = _schema_column_type_lower(schema_def, c0) == "time"
    raw_col = (
        f"{_sql_ident(table_alias)}.{_sql_ident(c0)}"
        if table_alias
        else _sql_ident(c0)
    )
    # DATE-typed columns: cast for all comparison operations so DuckDB
    # can compare correctly even when the underlying storage is VARCHAR.
    typed_col = f"TRY_CAST({raw_col} AS DATE)" if is_time else raw_col

    op = f.op
    if op == "is_null":
        return f"{raw_col} IS NULL"
    if op == "is_not_null":
        return f"{raw_col} IS NOT NULL"
    if op == "between":
        v = f.val
        if not isinstance(v, (list, tuple)) or len(v) != 2:
            return None
        lo, hi = v[0], v[1]
        if is_time:
            return (
                f"{typed_col} BETWEEN CAST({_sql_literal(lo)} AS DATE) "
                f"AND CAST({_sql_literal(hi)} AS DATE)"
            )
        return f"{typed_col} BETWEEN {_sql_literal(lo)} AND {_sql_literal(hi)}"
    if op == "in":
        v = f.val
        if not isinstance(v, (list, tuple)) or not v:
            return None
        vals_sql = ", ".join(_sql_literal(x) for x in v)
        return f"{raw_col} IN ({vals_sql})"
    if op == "contains":
        if not isinstance(f.val, str):
            return None
        sub = f.val.strip()
        if not sub:
            return None
        return f"contains(CAST({raw_col} AS VARCHAR), {_sql_literal(sub)})"
    if f.val is None:
        return None
    _OP_MAP = {"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
    sql_op = _OP_MAP.get(op)
    if sql_op is None:
        return None
    if is_time:
        return f"{typed_col} {sql_op} CAST({_sql_literal(f.val)} AS DATE)"
    return f"{raw_col} {sql_op} {_sql_literal(f.val)}"


def _where_from_clauses(
    clauses: list[FilterClauseV32],
    schema_def: dict[str, Any] | None,
) -> str | None:
    parts: list[str] = []
    for c in clauses:
        frag = _filter_clause_sql(c, schema_def)
        if frag is None:
            return None
        parts.append(f"({frag})")
    if not parts:
        return ""
    return " WHERE " + " AND ".join(parts)


def _atomic_cte_group_select_and_groupby(group_sql: list[str]) -> tuple[str, str]:
    """
    原子 CTE 的 grouping：SELECT 清單（… AS _g0, …）與 GROUP BY 必須共用**同一組**
    表達式字串（逐欄與 `group_sql[i]` 字面上完全一致）。例如 SELECT 使用
    `MONTH(col_1) AS _g0` 時，GROUP BY 須為 `MONTH(col_1)`，不可只寫 `col_1`
    （DuckDB／ PostgreSQL 會拒絕與 SELECT 清單不一致的 GROUP BY）。
    """
    gsel = ", ".join(f"{gx} AS _g{i}" for i, gx in enumerate(group_sql))
    gb = ", ".join(group_sql)
    return gsel, gb


def _group_expr_sql(raw: str, allowlist: set[str], schema_def: dict[str, Any] | None) -> str | None:
    s = raw.strip()
    m = _GROUP_FN.match(s)
    if m:
        fn, col = m.group(1).upper(), m.group(2)
        if fn not in _ALLOWED_GROUP_FN or col not in allowlist:
            return None
        ident = _sql_ident(col)
        cast_date = f"TRY_CAST({ident} AS DATE)"
        if fn == "MONTH":
            return f"CAST(EXTRACT(MONTH FROM {cast_date}) AS INTEGER)"
        if fn == "YEAR":
            return f"CAST(EXTRACT(YEAR FROM {cast_date}) AS INTEGER)"
        if fn == "QUARTER":
            return f"CAST(EXTRACT(QUARTER FROM {cast_date}) AS INTEGER)"
        return None
    if s in allowlist:
        return _sql_ident(s)
    return None


def _metric_where_clauses(intent: IntentV32, metric: MetricV32) -> list[FilterClauseV32]:
    if metric.filters:
        return list(metric.filters)
    out: list[FilterClauseV32] = []
    out.extend(intent.filters)
    if intent.dims.time_filter is not None:
        out.append(intent.dims.time_filter)
    return out


def _parse_atomic_agg(metric: MetricV32) -> tuple[str, str] | None:
    """
    單一 Atomic metric：`AGG(col_x)`，AGG ∈ SUM|AVG|COUNT|MIN|MAX。
    回傳 (函數名大寫, 欄位代碼)；否則為 Derived。
    """
    m = _ATOMIC_AGG.match(metric.formula)
    if not m:
        return None
    fn, col = m.group(1).upper(), m.group(2)
    if fn not in _ALLOWED_ATOMIC_AGG:
        return None
    return fn, col


def _formula_deps(formula: str) -> set[str]:
    return {x.lower() for x in _METRIC_REF.findall(formula)}


def _subst_formula_to_sql(
    formula: str,
    id_to_alias: dict[str, str],
    *,
    qualify_table: str | None = None,
) -> str:
    """
    Replace m* refs with CAST(alias AS DOUBLE).  Returns the expression string
    without adding extra outer parentheses — callers are responsible for any
    grouping they need.
    """
    s = str(formula).strip()
    ids = sorted(_formula_deps(s), key=len, reverse=True)
    for mid in ids:
        al = id_to_alias.get(mid.lower())
        if not al:
            continue
        col = _sql_ident(al)
        if qualify_table:
            repl = f"CAST({_sql_ident(qualify_table)}.{col} AS DOUBLE)"
        else:
            repl = f"CAST({col} AS DOUBLE)"
        s = re.sub(rf"\b{re.escape(mid)}\b", repl, s, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", s).strip()


def _topo_derived(
    derived_ids: list[str],
    deps_map: dict[str, set[str]],
) -> list[str] | None:
    indeg: dict[str, int] = {i: 0 for i in derived_ids}
    adj: dict[str, list[str]] = defaultdict(list)
    for v in derived_ids:
        for u in deps_map[v]:
            if u in derived_ids:
                adj[u].append(v)
                indeg[v] += 1
    q = deque([x for x in derived_ids if indeg[x] == 0])
    out: list[str] = []
    while q:
        u = q.popleft()
        out.append(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    if len(out) != len(derived_ids):
        return None
    return out


def try_build_sql_v32(
    intent: IntentV32,
    schema_def: dict[str, Any],
) -> tuple[str, list[Any], dict[str, Any]] | None:
    allow = column_allowlist_from_schema(schema_def)
    if not allow:
        return None

    if intent.mode == "list":
        return _build_list_sql(intent, allow, schema_def)
    return _build_calculate_sql(intent, allow, schema_def)


def _build_list_sql(
    intent: IntentV32,
    allow: set[str],
    schema_def: dict[str, Any],
) -> tuple[str, list[Any], dict[str, Any]] | None:
    for c in intent.select:
        if c not in allow:
            return None
    clauses: list[FilterClauseV32] = []
    clauses.extend(intent.filters)
    if intent.dims.time_filter is not None:
        clauses.append(intent.dims.time_filter)
    pp = intent.post_process
    if pp and pp.where is not None:
        clauses.append(pp.where)
    where_sql = _where_from_clauses(clauses, schema_def)
    if where_sql is None:
        return None
    cols_sql = ", ".join(_sql_ident(c) for c in intent.select)
    order = ""
    if pp and pp.sort:
        ob: list[str] = []
        for s in pp.sort:
            if s.col not in allow:
                return None
            ob.append(f"{_sql_ident(s.col)} {s.order.upper()}")
        order = " ORDER BY " + ", ".join(ob)
    lim = 100
    if pp and pp.limit is not None:
        lim = min(pp.limit, 100)
    sql = f"SELECT {cols_sql} FROM data{where_sql}{order} LIMIT {lim}"
    meta = {
        "mode": "list",
        "select_cols": list(intent.select),
        "group_cols": [],
        "agg_aliases": list(intent.select),
        "dataset_labels": [str(c) for c in intent.select],
        "is_list": True,
    }
    return sql, [], meta


def _derived_expr_for_formula(
    formula: str,
    id_to_alias: dict[str, str],
    *,
    qualify_table: str | None = None,
) -> str:
    """
    Build the SQL expression for a derived metric formula.

    - Top-level division (§3.3): wraps denominator with NULLIF(..., 0).
    - All m* refs are replaced with CAST(alias AS DOUBLE).
    - Returns a single expression string; no outer CAST wrapper is added
      (all operands are already DOUBLE, so arithmetic results stay DOUBLE).
    """
    num_d, den_d = _divide_num_den(formula)
    if num_d and den_d:
        num_sql = _subst_formula_to_sql(num_d, id_to_alias, qualify_table=qualify_table)
        den_sql = _subst_formula_to_sql(den_d, id_to_alias, qualify_table=qualify_table)
        return f"({num_sql} / NULLIF({den_sql}, 0))"
    return _subst_formula_to_sql(formula, id_to_alias, qualify_table=qualify_table)


def _build_calculate_sql(
    intent: IntentV32,
    allow: set[str],
    schema_def: dict[str, Any],
) -> tuple[str, list[Any], dict[str, Any]] | None:
    group_raw = list(intent.dims.groups)
    group_sql: list[str] = []
    for g in group_raw:
        ge = _group_expr_sql(g, allow, schema_def)
        if ge is None:
            return None
        group_sql.append(ge)

    id_to_metric = {m.id.strip().lower(): m for m in intent.metrics}
    atomic_ids: list[str] = []
    derived_ids: list[str] = []
    atomic_col_by_id: dict[str, str] = {}
    agg_fn_by_id: dict[str, str] = {}
    # window="total" atomic metrics（scalar CTE，CROSS JOIN 合併）
    window_ids: set[str] = set()

    for m in intent.metrics:
        mid = m.id.strip().lower()
        parsed = _parse_atomic_agg(m)
        if parsed is None:
            derived_ids.append(mid)
        else:
            fn, col = parsed
            if col not in allow:
                return None
            atomic_ids.append(mid)
            atomic_col_by_id[mid] = col
            agg_fn_by_id[mid] = fn
            if m.window == "total":
                window_ids.add(mid)

    id_to_alias = {m.id.strip().lower(): m.alias for m in intent.metrics}

    deps_map: dict[str, set[str]] = {}
    for mid in derived_ids:
        m = id_to_metric[mid]
        deps = _formula_deps(m.formula)
        if deps - set(id_to_alias.keys()):
            return None
        deps_map[mid] = deps
    for mid in atomic_ids:
        deps_map[mid] = set()

    topo_d = _topo_derived(derived_ids, deps_map) if derived_ids else []
    if derived_ids and topo_d is None:
        return None

    if not atomic_ids:
        return None

    atomic_id_set = set(atomic_ids)
    derived_depends_only_atom = bool(topo_d) and all(
        deps_map[d] <= atomic_id_set for d in topo_d
    )

    ctes: list[str] = []
    cte_safe_by_aid: dict[str, str] = {}
    for aid in atomic_ids:
        m = id_to_metric[aid]
        mclauses = _metric_where_clauses(intent, m)
        wh = _where_from_clauses(mclauses, schema_def)
        if wh is None:
            return None
        col_ident = _sql_ident(atomic_col_by_id[aid])
        agg_fn = agg_fn_by_id[aid]
        agg_call = f"{agg_fn}({col_ident})"
        agg_alias = _sql_ident(m.alias)
        safe_cte = re.sub(r"[^a-zA-Z0-9_]", "_", m.id) or "m"
        cte_safe_by_aid[aid] = safe_cte
        if aid in window_ids:
            # scalar CTE：不帶 GROUP BY
            ctes.append(f"cte_{safe_cte} AS (SELECT {agg_call} AS {agg_alias} FROM data{wh})")
        elif group_sql:
            gsel, gb = _atomic_cte_group_select_and_groupby(group_sql)
            ctes.append(
                f"cte_{safe_cte} AS (SELECT {gsel}, {agg_call} AS {agg_alias} "
                f"FROM data{wh} GROUP BY {gb})"
            )
        else:
            ctes.append(f"cte_{safe_cte} AS (SELECT {agg_call} AS {agg_alias} FROM data{wh})")

    # 將 atomic_ids 分成「有分組（normal）」與「scalar（window）」兩類，以決定 JOIN 策略：
    # - normal metrics 之間：FULL OUTER JOIN on group keys
    # - window metrics：CROSS JOIN（scalar，無 group key）
    normal_aids = [aid for aid in atomic_ids if aid not in window_ids]
    window_aids = [aid for aid in atomic_ids if aid in window_ids]

    # 第二階段 merge_sql
    sel_dims: list[str] = []
    if group_sql:
        # dim_ 只從 normal metrics 取（window metric 無 _g 欄位）
        ref_aids_for_dim = normal_aids if normal_aids else atomic_ids
        for i in range(len(group_sql)):
            coalesce_parts = [f"t{normal_aids.index(aid)}._g{i}" for aid in ref_aids_for_dim]
            cexpr = "COALESCE(" + ", ".join(coalesce_parts) + ")"
            sel_dims.append(f"{cexpr} AS dim_{i}")

    merge_sel = list(sel_dims)

    # normal metrics：保留順序索引
    normal_idx = {aid: i for i, aid in enumerate(normal_aids)}
    window_offset = len(normal_aids)

    for j, aid in enumerate(normal_aids):
        al = _sql_ident(id_to_alias[aid])
        merge_sel.append(f"t{j}.{al} AS {al}")
    for k, aid in enumerate(window_aids):
        al = _sql_ident(id_to_alias[aid])
        merge_sel.append(f"w{k}.{al} AS {al}")

    # FROM / JOIN
    if normal_aids:
        first_aid = normal_aids[0]
        from_first = f"cte_{cte_safe_by_aid[first_aid]} t0"
        join_parts = [from_first]
        for j in range(1, len(normal_aids)):
            aid = normal_aids[j]
            on_parts = []
            if group_sql:
                for i in range(len(group_sql)):
                    on_parts.append(f"t0._g{i} = t{j}._g{i}")
            jc = " AND ".join(on_parts) if on_parts else "TRUE"
            join_parts.append(f"FULL OUTER JOIN cte_{cte_safe_by_aid[aid]} t{j} ON {jc}")
        for k, aid in enumerate(window_aids):
            join_parts.append(f"CROSS JOIN cte_{cte_safe_by_aid[aid]} w{k}")
    elif window_aids:
        # 全部都是 window（極少見），直接 CROSS JOIN 所有 scalar CTE
        first_aid = window_aids[0]
        join_parts = [f"cte_{cte_safe_by_aid[first_aid]} w0"]
        for k in range(1, len(window_aids)):
            aid = window_aids[k]
            join_parts.append(f"CROSS JOIN cte_{cte_safe_by_aid[aid]} w{k}")
    else:
        return None

    merge_sql = f"SELECT {', '.join(merge_sel)} FROM " + " ".join(join_parts)

    v0 = "v0"
    mrg = "mrg"
    row_alias = v0

    if not topo_d:
        inner = merge_sql
    elif derived_depends_only_atom:
        proj: list[str] = []
        for i in range(len(group_sql)):
            proj.append(f"{_sql_ident(mrg)}.{_sql_ident(f'dim_{i}')}")
        for aid in normal_aids:
            proj.append(f"{_sql_ident(mrg)}.{_sql_ident(id_to_alias[aid])}")
        for aid in window_aids:
            proj.append(f"{_sql_ident(mrg)}.{_sql_ident(id_to_alias[aid])}")
        for mid in topo_d:
            m = id_to_metric[mid]
            expr_sql = _derived_expr_for_formula(m.formula, id_to_alias, qualify_table=mrg)
            proj.append(f"{expr_sql} AS {_sql_ident(m.alias)}")
        inner = f"SELECT {', '.join(proj)} FROM ({merge_sql}) AS {_sql_ident(mrg)}"
    else:
        m0 = id_to_metric[topo_d[0]]
        chain = (
            f"SELECT {_sql_ident(mrg)}.*, "
            f"{_derived_expr_for_formula(m0.formula, id_to_alias, qualify_table=mrg)} "
            f"AS {_sql_ident(m0.alias)} "
            f"FROM ({merge_sql}) AS {_sql_ident(mrg)}"
        )
        for idx in range(1, len(topo_d)):
            mid = topo_d[idx]
            m = id_to_metric[mid]
            nxt = f"x{idx}"
            expr_sql = _derived_expr_for_formula(m.formula, id_to_alias, qualify_table=nxt)
            chain = (
                f"SELECT {_sql_ident(nxt)}.*, {expr_sql} AS {_sql_ident(m.alias)} "
                f"FROM ({chain}) AS {_sql_ident(nxt)}"
            )
        inner = chain

    sel = f"SELECT * FROM ({inner}) AS {_sql_ident(v0)}"

    pp = intent.post_process
    dim_names = [f"dim_{i}" for i in range(len(group_sql))]
    out_aliases = (
        [id_to_alias[a] for a in normal_aids]
        + [id_to_alias[a] for a in window_aids]
        + [id_to_metric[d].alias for d in (topo_d or [])]
    )
    extras: list[str] = []
    if pp:
        if pp.where is not None:
            fw = _filter_clause_sql(pp.where, schema_def, table_alias=row_alias)
            if fw is None:
                return None
            extras.append(f"WHERE {fw}")
        if pp.sort:
            ob: list[str] = []
            for s in pp.sort:
                key = s.col.strip()
                sort_key: str | None = None
                for gi, gr in enumerate(group_raw):
                    if key == str(gr).strip():
                        sort_key = f"{_sql_ident(row_alias)}.dim_{gi}"
                        break
                if sort_key is None:
                    if key in dim_names or key in out_aliases:
                        sort_key = f"{_sql_ident(row_alias)}.{_sql_ident(key)}"
                    else:
                        ge = _group_expr_sql(key, allow, schema_def)
                        if ge is None:
                            return None
                        sort_key = ge
                ob.append(f"{sort_key} {s.order.upper()}")
            extras.append("ORDER BY " + ", ".join(ob))
        if pp.limit is not None:
            extras.append(f"LIMIT {int(pp.limit)}")
    tail = (" " + " ".join(extras)) if extras else ""
    out_sql = "WITH " + ", ".join(ctes) + " " + sel + tail

    labels = [_dataset_label_for_formula_alias(a, schema_def) for a in out_aliases]
    meta = {
        "mode": "calculate",
        "group_cols": dim_names,
        "agg_aliases": out_aliases,
        "dataset_labels": labels,
        "is_list": False,
    }
    return out_sql, [], meta


def _divide_num_den(formula: str) -> tuple[str | None, str | None]:
    s = formula.strip()
    if "/" not in s:
        return None, None
    depth = 0
    split_at = -1
    for i, ch in enumerate(s):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "/" and depth == 0:
            split_at = i
            break
    if split_at < 0:
        return None, None
    return s[:split_at].strip(), s[split_at + 1 :].strip()
