"""
compute_engine：intent 一律先轉成參數化 SQL，由 DuckDB 執行後組出圖表資料。

無法轉 SQL 或執行失敗時回傳 error_detail，不使用全表載入的 Python 聚合替代。
（本檔仍保留 _aggregate_pairs / _apply_filters_v1 供單元測試與潛在非 SQL 工具使用。）
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.schemas.intent_v3 import USER_FACING_INTENT_V3_LEGACY_NO_ENGINE, is_intent_v3
from app.services.compute_engine_sql import run_sql_compute_engine, run_sql_compute_engine_v32, run_sql_compute_engine_v4
from app.services.duckdb_store import resolve_duckdb_path

SQL_ENGINE_VERSION = 2


def _between_bounds(f: dict[str, Any]) -> tuple[Any, Any] | None:
    if f.get("start") is not None and f.get("end") is not None:
        return f.get("start"), f.get("end")
    v = f.get("value")
    if isinstance(v, (list, tuple)) and len(v) == 2:
        return v[0], v[1]
    if isinstance(v, str) and "/" in v:
        a, b = v.split("/", 1)
        return a.strip(), b.strip()
    return None


def _coerce_float(x: Any) -> float | None:
    if x is None:
        return None
    if isinstance(x, bool):
        return float(int(x))
    if isinstance(x, (int, float)):
        return float(x)
    try:
        return float(str(x).strip().replace(",", ""))
    except (ValueError, TypeError):
        return None


def _apply_filters_v1(rows: list[dict[str, Any]], intent: dict[str, Any]) -> list[dict[str, Any]]:
    filters = intent.get("filters")
    if not isinstance(filters, list) or not filters:
        return rows
    out = list(rows)
    for f in filters:
        if not isinstance(f, dict):
            continue
        col = f.get("column") or f.get("col")
        if col is None or not str(col).strip():
            continue
        col = str(col).strip()
        op_norm = str(f.get("op") or "==").strip().lower().replace(" ", "")
        if op_norm in ("==", "=", "eq"):
            val = f.get("value") if "value" in f else f.get("val")
            out = [r for r in out if r.get(col) == val or str(r.get(col)) == str(val)]
        elif op_norm == "between":
            bounds = _between_bounds(f)
            if bounds is None:
                continue
            lo, hi = bounds
            slo, shi = str(lo).strip(), str(hi).strip()

            def _in_between(r: dict[str, Any]) -> bool:
                x = r.get(col)
                if x is None:
                    return False
                sx = str(x).strip()
                return slo <= sx <= shi

            out = [r for r in out if _in_between(r)]
        elif op_norm == "in":
            vals = f.get("values") if isinstance(f.get("values"), list) else f.get("value")
            if not isinstance(vals, list) or not vals:
                continue
            strset = {str(v) for v in vals}
            out = [r for r in out if r.get(col) in vals or str(r.get(col)) in strset]
    return out


def _aggregate_pairs(
    rows: list[dict[str, Any]],
    group_col: str | None,
    val_col: str,
    agg: str,
) -> list[tuple[Any, float]]:
    if group_col:
        if agg == "count":
            counts: dict[Any, int] = defaultdict(int)
            for r in rows:
                counts[r.get(group_col)] += 1
            return [(g, float(c)) for g, c in counts.items()]
        sums: dict[Any, float] = defaultdict(float)
        cnts: dict[Any, int] = defaultdict(int)
        for r in rows:
            g = r.get(group_col)
            fv = _coerce_float(r.get(val_col))
            if fv is None:
                continue
            sums[g] += fv
            cnts[g] += 1
        if agg == "avg":
            return [(g, sums[g] / cnts[g] if cnts[g] else 0.0) for g in sums]
        return [(g, sums[g]) for g in sums]

    if agg == "count":
        return [("總計", float(len(rows)))]
    sums_t = 0.0
    cnt_t = 0
    for r in rows:
        fv = _coerce_float(r.get(val_col))
        if fv is None:
            continue
        sums_t += fv
        cnt_t += 1
    if agg == "avg":
        return [("總計", sums_t / cnt_t if cnt_t else 0.0)]
    return [("總計", sums_t)]


def run_compute_engine(
    duckdb_name: str,
    intent: dict[str, Any],
    schema_def: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None, dict[str, Any]]:
    """
    回傳 (chart_result, error_detail, debug)。
    debug 含產生的 SQL（成功組出時）。
    """
    if not schema_def or not isinstance(schema_def, dict):
        return None, "schema_def 必須為有效物件（供後續版本對欄位語意校驗）", {"sql_only": True, "sql_pushdown": False}

    # v4.0 優先分流
    from app.schemas.intent_v4 import is_intent_v4_payload
    if is_intent_v4_payload(intent):
        path_v4 = resolve_duckdb_path((duckdb_name or "").strip())
        if path_v4 is None:
            return (
                None,
                f"找不到 DuckDB 檔案（名稱={duckdb_name!r}），請確認 DUCKDB_DATA_DIR 或絕對路徑",
                {"sql_only": True, "sql_pushdown": False},
            )
        return run_sql_compute_engine_v4(path_v4, intent, schema_def, engine_version=40)

    if is_intent_v3(intent):
        from app.schemas.intent_v32 import is_intent_v32_payload

        if not is_intent_v32_payload(intent):
            return (
                None,
                USER_FACING_INTENT_V3_LEGACY_NO_ENGINE,
                {"intent_version": "v3legacy", "sql_only": True, "sql_pushdown": False},
            )
        path_v32 = resolve_duckdb_path((duckdb_name or "").strip())
        if path_v32 is None:
            return (
                None,
                f"找不到 DuckDB 檔案（名稱={duckdb_name!r}），請確認 DUCKDB_DATA_DIR 或絕對路徑",
                {"sql_only": True, "sql_pushdown": False},
            )
        return run_sql_compute_engine_v32(path_v32, intent, schema_def, engine_version=32)

    path = resolve_duckdb_path((duckdb_name or "").strip())
    if path is None:
        return (
            None,
            f"找不到 DuckDB 檔案（名稱={duckdb_name!r}），請確認 DUCKDB_DATA_DIR 或絕對路徑",
            {"sql_only": True, "sql_pushdown": False},
        )

    return run_sql_compute_engine(
        path, intent, schema_def, engine_version=SQL_ENGINE_VERSION
    )
