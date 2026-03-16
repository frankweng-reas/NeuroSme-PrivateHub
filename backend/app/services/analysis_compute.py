"""
分析 compute flow：意圖萃取、資料解析、後端計算

架構：
  Layer 1 資料輸入：parse_csv, infer_schema, get_schema_summary
  Layer 2 欄位解析：_resolve_columns, _apply_filter
  Layer 3 彙總計算：_aggregate_single_series, _aggregate_multi_series
  Layer 4 後處理：_apply_sort_top_n, _to_pie_percent
"""
import csv
import io
import logging
import re
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# =============================================================================
# Layer 1：資料輸入
# =============================================================================


def parse_csv_content(content: str) -> list[dict[str, Any]] | None:
    """解析 CSV 字串為 list of dict。第一列為 header。"""
    if not content or not content.strip():
        return None
    try:
        reader = csv.DictReader(io.StringIO(content.strip()), delimiter=",", quoting=csv.QUOTE_MINIMAL)
        rows = list(reader)
        return rows if rows else None
    except Exception as e:
        logger.warning("parse_csv_content 失敗: %s", e)
        return None


def infer_schema(rows: list[dict[str, Any]]) -> dict[str, str]:
    """從資料推斷欄位與型別。數值欄位：可轉 float 的樣本 > 50%；否則為 string。"""
    if not rows:
        return {}
    schema: dict[str, str] = {}
    sample = rows[: min(100, len(rows))]
    for key in rows[0].keys():
        if not key or not key.strip():
            continue
        k = key.strip()
        numeric_count = 0
        for r in sample:
            v = r.get(key)
            if v is None or v == "":
                continue
            try:
                float(str(v).replace(",", "").replace(" ", ""))
                numeric_count += 1
            except (ValueError, TypeError):
                pass
        schema[k] = "number" if numeric_count > len(sample) * 0.5 else "string"
    return schema


def get_schema_summary(rows: list[dict[str, Any]], schema_def: dict[str, Any] | None = None) -> str:
    """
    產生給 LLM 的 schema 摘要。
    schema_def 為 None 時：infer_schema + 第一列範例。
    schema_def 有值時：依 columns 產生「欄位名 (型別) [用途] 範例」，僅列出 rows 中存在的欄位。
    """
    if not rows:
        return "無資料"
    actual_keys = [k for k in rows[0].keys() if k and k.strip()]
    sample = rows[0]
    inferred = infer_schema(rows)

    if not schema_def or not schema_def.get("columns"):
        cols = list(inferred.keys())
        sample_str = ", ".join(f"{k}={repr(sample.get(k, ''))[:30]}" for k in cols[:8])
        return f"欄位：{cols}\n型別：{inferred}\n第一列範例：{sample_str}"

    lines: list[str] = []
    columns = schema_def.get("columns") or {}
    for col in actual_keys:
        col_def = columns.get(col) if isinstance(columns.get(col), dict) else None
        if col_def:
            purposes = col_def.get("purposes")
            purposes_str = ",".join(purposes) if isinstance(purposes, list) else str(purposes or "")
            col_type = col_def.get("type", inferred.get(col, "string"))
            ex = col_def.get("example") or sample.get(col, "")
            lines.append(f"{col} ({col_type}) [{purposes_str}] 範例: {ex}")
        else:
            col_type = inferred.get(col, "string")
            ex = sample.get(col, "")
            lines.append(f"{col} ({col_type}) 範例: {ex}")
    return "\n".join(lines)


# =============================================================================
# Layer 2：欄位解析與輔助
# =============================================================================

# schema_def 為 None 時的 fallback 別名
_FALLBACK_GROUP_ALIASES: dict[str, list[str]] = {
    "平台": ["平台", "各平台", "通路", "channel", "platform"],
    "月份": ["月份", "月", "日期", "month", "date", "event_date"],
    "品類": ["品類", "類別", "category_l1", "category_l2"],
    "產品名稱": ["產品名稱", "產品", "品名", "item_name", "item"],
}
_FALLBACK_VALUE_ALIASES: dict[str, list[str]] = {
    "銷售金額": ["銷售金額", "銷售額", "金額", "net_amount", "gross_amount"],
    "銷售數量": ["銷售數量", "數量", "quantity"],
    "毛利": ["毛利", "gross_profit"],
    "營收": ["營收", "net_amount", "revenue"],
    "成本": ["成本", "cost_amount", "預估成本"],
}


def _parse_num(v: Any) -> float:
    """解析數值，支援千分位逗號"""
    if v is None or v == "":
        return 0.0
    try:
        return float(str(v).replace(",", "").replace(" ", ""))
    except (ValueError, TypeError):
        return 0.0


def _time_sort_key(s: str) -> tuple[int, int]:
    """將時間字串轉為 (year, month) 用於排序"""
    s = str(s).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = re.match(r"^(\d{1,2})月", s)
    if m:
        return (0, int(m.group(1)))
    months = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
    for name, num in months.items():
        if s.lower().startswith(name):
            return (0, num)
    return (0, 0)


def _find_matching_column(actual_keys: list[str], intent_name: str | None, aliases: dict[str, list[str]]) -> str | None:
    """依意圖名稱或別名，從實際欄位中找最佳匹配。"""
    if not intent_name or not actual_keys:
        return None
    intent_clean = intent_name.strip()
    for k in actual_keys:
        if k.strip() == intent_clean:
            return k
    for k in actual_keys:
        k_clean = k.strip()
        if intent_clean in k_clean or k_clean in intent_clean:
            return k
    for alias_key, keywords in aliases.items():
        if intent_clean in keywords or any(kw in intent_clean for kw in keywords):
            for k in actual_keys:
                k_clean = k.strip().lower()
                for kw in keywords:
                    if kw.lower() in k_clean or k_clean in kw.lower():
                        return k
    return None


def _normalize_for_match(s: str) -> str:
    """正規化字串用於比對：小寫、去空白、合併空格"""
    return "".join(str(s or "").strip().lower().split())


def _parse_date_safe(s: str) -> tuple[int, int, int] | None:
    """解析日期字串為 (y, m, d)，支援 YYYY-MM-DD、YYYY/MM/DD、YYYYMMDD"""
    if not s or not isinstance(s, str):
        return None
    s = str(s).strip()
    m = re.match(r"^(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{4})(\d{2})(\d{2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


_DATE_COLUMN_NAMES: frozenset[str] = frozenset({"event_date", "event-date", "date", "月份", "month"})


def _is_date_column(column: str) -> bool:
    """是否為日期欄位（用於 BETWEEN/>= <= 邏輯）"""
    c = (column or "").strip().lower()
    return c in _DATE_COLUMN_NAMES or "date" in c


def _apply_filter(
    rows: list[dict[str, Any]],
    filter_key: str,
    filter_value: Any,
    *,
    is_date_column: bool = False,
) -> list[dict[str, Any]]:
    """依 filter_value 篩選 rows。event_date 用日期區間；其他維度用 = 或 IN/包含。"""
    if not rows or not filter_key or filter_value is None:
        return rows
    if isinstance(filter_value, list):
        allowed_norm = {_normalize_for_match(str(v)) for v in filter_value if v}
        result = [r for r in rows if _normalize_for_match(str(r.get(filter_key, "") or "")) in allowed_norm]
        if not result:
            result = [r for r in rows if any(t in _normalize_for_match(str(r.get(filter_key, "") or "")) for t in allowed_norm)]
        return result
    val_str = str(filter_value).strip()
    # 日期欄位：優先用 BETWEEN（YYYY-MM-DD/YYYY-MM-DD）或單日
    if is_date_column:
        if "/" in val_str and re.match(r"^\d{4}[-/]?\d{1,2}[-/]?\d{1,2}\s*/\s*\d{4}[-/]?\d{1,2}[-/]?\d{1,2}", val_str.replace(" ", "")):
            parts = val_str.split("/", 1)
            start_d = _parse_date_safe(parts[0].strip())
            end_d = _parse_date_safe(parts[1].strip())
            if start_d and end_d:
                result = []
                for r in rows:
                    cell = r.get(filter_key)
                    d = _parse_date_safe(str(cell) if cell is not None else "")
                    if d and start_d <= d <= end_d:
                        result.append(r)
                return result
        else:
            single_d = _parse_date_safe(val_str)
            if single_d:
                result = [r for r in rows if _parse_date_safe(str(r.get(filter_key, "") or "")) == single_d]
                if result:
                    return result
    # 非日期或日期解析失敗：= 或 包含
    target_norm = _normalize_for_match(str(filter_value))
    exact = [r for r in rows if _normalize_for_match(str(r.get(filter_key, "") or "")) == target_norm]
    contains = [r for r in rows if target_norm in _normalize_for_match(str(r.get(filter_key, "") or ""))]
    if exact:
        seen = {id(r) for r in exact}
        for r in contains:
            if id(r) not in seen:
                exact.append(r)
                seen.add(id(r))
        return exact
    return contains if contains else []


@dataclass
class _ResolvedColumns:
    """解析後的欄位對應"""
    group_key: str
    value_keys: list[str]
    filter_key: str | None
    series_key: str | None


def _resolve_columns(
    rows: list[dict[str, Any]],
    group_by_column: str | None,
    value_column: str | None,
    value_columns: list[str] | None,
    filter_column: str | None,
    series_by_column: str | None,
    *,
    group_aliases: dict[str, list[str]] | None = None,
    value_aliases: dict[str, list[str]] | None = None,
) -> _ResolvedColumns | None:
    """
    將 intent 的欄位名稱解析為實際的 row keys。
    group_aliases / value_aliases 為 None 時使用 fallback。
    """
    if not rows or not group_by_column:
        return None
    actual_keys = [k for k in rows[0].keys() if k and k.strip()]
    g_aliases = group_aliases or _FALLBACK_GROUP_ALIASES
    v_aliases = value_aliases or _FALLBACK_VALUE_ALIASES

    # value_keys
    value_keys: list[str] = []
    if value_columns:
        for vc in value_columns:
            vc_clean = str(vc).strip()
            if not vc_clean:
                continue
            k = next((ak for ak in actual_keys if ak.strip() == vc_clean), None) or _find_matching_column(actual_keys, vc_clean, v_aliases)
            if k and k not in value_keys:
                value_keys.append(k)
        if not value_keys:
            for vc in value_columns:
                vc_clean = str(vc).strip().lower()
                for ak in actual_keys:
                    if vc_clean in ak.strip().lower() or ak.strip().lower() in vc_clean:
                        if ak not in value_keys:
                            value_keys.append(ak)
                        break
    if not value_keys and value_column:
        k = next((ak for ak in actual_keys if ak.strip() == value_column.strip()), None) or _find_matching_column(actual_keys, value_column, v_aliases)
        if k:
            value_keys = [k]
    if not value_keys:
        logger.warning("找不到 value 欄位: value_column=%r value_columns=%r", value_column, value_columns)
        return None

    # group_key
    group_key = next((ak for ak in actual_keys if ak.strip() == group_by_column.strip()), None) or _find_matching_column(actual_keys, group_by_column, g_aliases)
    if not group_key:
        logger.warning("找不到 group_by 欄位: %r", group_by_column)
        return None

    # filter_key
    filter_key = None
    if filter_column:
        filter_key = _find_matching_column(actual_keys, filter_column, g_aliases) or (filter_column if filter_column in actual_keys else None)

    # series_key
    series_key = None
    if series_by_column:
        series_key = next((ak for ak in actual_keys if ak.strip() == series_by_column.strip()), None) or _find_matching_column(actual_keys, series_by_column, g_aliases)

    return _ResolvedColumns(group_key=group_key, value_keys=value_keys, filter_key=filter_key, series_key=series_key)


# =============================================================================
# Layer 3：彙總計算
# =============================================================================


# 複合指標：indicator -> (分子索引, 分母索引, 是否顯示為百分比)
_COMPOUND_INDICATORS: dict[str, tuple[int, int, bool]] = {
    "margin_rate": (0, 1, True),    # gross_profit / net_amount
    "roi": (0, 1, False),           # gross_profit / cost_amount
    "arpu": (0, 1, False),          # net_amount / quantity
    "discount_rate": (0, 1, True),  # discount_amount / net_amount
}
# 複合指標欄位名稱（用於 value_keys 多於 2 時依名稱找）
_INDICATOR_COLUMN_NAMES: dict[str, tuple[str, str]] = {
    "margin_rate": ("gross_profit", "net_amount"),
    "roi": ("gross_profit", "cost_amount"),
    "arpu": ("net_amount", "quantity"),
    "discount_rate": ("discount_amount", "net_amount"),
}
# 複合指標單一總計時的 label 顯示名稱
_INDICATOR_LABELS: dict[str, str] = {
    "margin_rate": "毛利率",
    "roi": "ROI",
    "arpu": "客單價",
    "discount_rate": "折扣率",
}
# 多欄位彙總時的顯示名稱（總毛利、總成本等）
_VALUE_DISPLAY_NAMES: dict[str, str] = {
    "gross_profit": "毛利",
    "cost_amount": "成本",
    "net_amount": "銷售金額",
    "quantity": "銷售數量",
    "discount_amount": "折扣金額",
}
# display_fields 對應：用戶輸入 -> 內部 label（用於過濾輸出）
_DISPLAY_FIELD_ALIASES: dict[str, list[str]] = {
    "毛利": ["毛利", "總毛利", "gross_profit"],
    "成本": ["成本", "總成本", "cost_amount"],
    "銷售金額": ["銷售金額", "總銷售金額", "net_amount"],
    "ROI": ["ROI", "roi"],
    "毛利率": ["毛利率", "margin_rate"],
    "客單價": ["客單價", "arpu"],
    "折扣率": ["折扣率", "discount_rate"],
    "折扣金額": ["折扣金額", "discount_amount"],
    "銷售數量": ["銷售數量", "總銷售數量", "quantity"],
}


def _apply_display_fields(
    pairs: list[tuple[str, float]],
    display_fields: list[str],
) -> list[tuple[str, float]]:
    """依 display_fields 過濾並排序，只保留用戶要求的項目。"""
    if not display_fields or not pairs:
        return pairs
    label_to_val = {p[0]: p[1] for p in pairs}
    result: list[tuple[str, float]] = []
    seen: set[str] = set()
    for df in display_fields:
        df_clean = (df or "").strip()
        if not df_clean:
            continue
        for label, aliases in _DISPLAY_FIELD_ALIASES.items():
            if label in seen:
                continue
            if df_clean in aliases or df_clean == label:
                if label in label_to_val:
                    result.append((label, label_to_val[label]))
                    seen.add(label)
                break
    return result if result else pairs


def _aggregate_indicator_ratio(
    rows: list[dict[str, Any]],
    group_key: str,
    num_key: str,
    denom_key: str,
    as_percent: bool,
) -> list[tuple[str, float]]:
    """複合指標：依 group 分組，每組 sum(num)/sum(denom)。as_percent 時 ×100"""
    groups_num: dict[str, float] = {}
    groups_denom: dict[str, float] = {}
    for r in rows:
        gv = str(r.get(group_key, "") or "").strip() or "(空)"
        groups_num[gv] = groups_num.get(gv, 0) + _parse_num(r.get(num_key))
        groups_denom[gv] = groups_denom.get(gv, 0) + _parse_num(r.get(denom_key))
    result: list[tuple[str, float]] = []
    for gv in groups_num:
        denom = groups_denom.get(gv, 0)
        if denom == 0:
            result.append((gv, 0.0))
        else:
            val = groups_num[gv] / denom
            if as_percent:
                val = round(val * 100, 2)
            else:
                val = round(val, 4)
            result.append((gv, val))
    return result


def _aggregate_multi_value(
    rows: list[dict[str, Any]],
    value_keys: list[str],
    aggregation: str,
) -> list[tuple[str, float]]:
    """多欄位分別彙總：每個 value_key 獨立 sum，回傳 [(label, value), ...]"""
    agg = (aggregation or "sum").lower()
    result: list[tuple[str, float]] = []
    for vk in value_keys:
        total = sum(_parse_num(r.get(vk)) for r in rows)
        if agg == "avg" and rows:
            total = total / len(rows)
        elif agg == "count":
            total = float(len(rows))
        label = _VALUE_DISPLAY_NAMES.get(vk, vk)
        result.append((label, round(total, 2)))
    return result


def _aggregate_single_series(
    rows: list[dict[str, Any]],
    group_key: str,
    value_keys: list[str],
    aggregation: str,
) -> list[tuple[str, float]]:
    """單一系列：依 group_key 分組，對 value_keys 彙總。回傳 [(label, value), ...]"""
    groups: dict[str, float] = {}
    agg = (aggregation or "sum").lower()
    for r in rows:
        gv = str(r.get(group_key, "") or "").strip() or "(空)"
        val = 1.0 if agg == "count" else sum(_parse_num(r.get(k)) for k in value_keys)
        groups[gv] = groups.get(gv, 0) + val
    if agg == "avg" and groups:
        counts: dict[str, float] = {}
        for r in rows:
            gv = str(r.get(group_key, "") or "").strip() or "(空)"
            counts[gv] = counts.get(gv, 0) + 1
        for k in groups:
            if counts.get(k, 0) > 0:
                groups[k] = groups[k] / counts[k]
    return list(groups.items())


def _aggregate_multi_series(
    rows: list[dict[str, Any]],
    group_key: str,
    series_key: str,
    value_keys: list[str],
    aggregation: str,
) -> tuple[list[str], list[tuple[str, list[float]]]]:
    """多系列：pivot[(group_val, series_val)] = value。回傳 (labels, [(series_label, [vals])])"""
    pivot: dict[tuple[str, str], float] = {}
    agg = (aggregation or "sum").lower()
    for r in rows:
        gv = str(r.get(group_key, "") or "").strip() or "(空)"
        sv = str(r.get(series_key, "") or "").strip() or "(空)"
        val = sum(_parse_num(r.get(k)) for k in value_keys)
        if agg == "count":
            val = 1.0
        key = (gv, sv)
        pivot[key] = pivot.get(key, 0) + val
    if agg == "avg":
        counts: dict[tuple[str, str], float] = {}
        for r in rows:
            gv = str(r.get(group_key, "") or "").strip() or "(空)"
            sv = str(r.get(series_key, "") or "").strip() or "(空)"
            counts[(gv, sv)] = counts.get((gv, sv), 0) + 1
        for k in pivot:
            if counts.get(k, 0) > 0:
                pivot[k] = pivot[k] / counts[k]
    group_vals = sorted({g for g, _ in pivot.keys()})
    series_vals = sorted({s for _, s in pivot.keys()})
    datasets: list[tuple[str, list[float]]] = []
    for sv in series_vals:
        data = [pivot.get((gv, sv), 0) for gv in group_vals]
        datasets.append((sv, data))
    return group_vals, datasets


def _aggregate_multi_series_with_metrics(
    rows: list[dict[str, Any]],
    group_key: str,
    series_key: str,
    value_keys: list[str],
    aggregation: str,
    indicator: str | None,
    display_fields: list[str],
) -> tuple[list[str], list[tuple[str, list[float]]]]:
    """多系列 + 多指標：支援 indicator (ROI 等) 與 display_fields。"""
    ind = (indicator or "").strip().lower()
    # 每個 value_key 的 pivot
    pivots: dict[str, dict[tuple[str, str], float]] = {}
    for vk in value_keys:
        pivots[vk] = {}
    pivot_ind_num: dict[tuple[str, str], float] = {}
    pivot_ind_denom: dict[tuple[str, str], float] = {}
    num_key = denom_key = None
    if ind in _INDICATOR_COLUMN_NAMES:
        nc, dc = _INDICATOR_COLUMN_NAMES[ind]
        num_key = next((k for k in value_keys if k == nc or nc in k), None)
        denom_key = next((k for k in value_keys if k == dc or dc in k), None)
    agg = (aggregation or "sum").lower()
    for r in rows:
        gv = str(r.get(group_key, "") or "").strip() or "(空)"
        sv = str(r.get(series_key, "") or "").strip() or "(空)"
        key = (gv, sv)
        for vk in value_keys:
            pivots[vk][key] = pivots[vk].get(key, 0) + _parse_num(r.get(vk))
        if num_key and denom_key:
            pivot_ind_num[key] = pivot_ind_num.get(key, 0) + _parse_num(r.get(num_key))
            pivot_ind_denom[key] = pivot_ind_denom.get(key, 0) + _parse_num(r.get(denom_key))
    group_vals = sorted({g for p in pivots.values() for g, _ in p.keys()} | {g for g, _ in pivot_ind_num.keys()})
    series_vals = sorted({s for p in pivots.values() for _, s in p.keys()} | {s for _, s in pivot_ind_num.keys()})
    # 依 display_fields 組 datasets
    metrics_to_show: list[tuple[str, str, str]] = []  # (display_label, type, key)
    for df in (display_fields or []):
        df_clean = (df or "").strip()
        if not df_clean:
            continue
        for label, aliases in _DISPLAY_FIELD_ALIASES.items():
            if any(_normalize_for_match(str(a)) == _normalize_for_match(df_clean) for a in aliases) or _normalize_for_match(df_clean) == _normalize_for_match(label):
                if label == _INDICATOR_LABELS.get(ind, ind.upper() if ind else ""):
                    metrics_to_show.append((label, "indicator", ind))
                else:
                    vk = next((k for k, v in _VALUE_DISPLAY_NAMES.items() if v == label), None) or next((k for k in value_keys if _VALUE_DISPLAY_NAMES.get(k) == label), None)
                    if vk and vk in value_keys:
                        metrics_to_show.append((label, "value", vk))
                break
    if not metrics_to_show and display_fields:
        for vk in value_keys:
            lbl = _VALUE_DISPLAY_NAMES.get(vk, vk)
            metrics_to_show.append((lbl, "value", vk))
        if ind in _INDICATOR_LABELS:
            metrics_to_show.append((_INDICATOR_LABELS[ind], "indicator", ind))
    datasets_out: list[tuple[str, list[float]]] = []
    for metric_label, mtype, mkey in metrics_to_show:
        for sv in series_vals:
            if mtype == "indicator" and num_key and denom_key:
                vals = []
                for gv in group_vals:
                    denom = pivot_ind_denom.get((gv, sv), 0)
                    vals.append(round(pivot_ind_num.get((gv, sv), 0) / denom, 4) if denom else 0.0)
                datasets_out.append((f"{metric_label} - {sv}", vals))
            elif mtype == "value":
                vals = [round(pivots.get(mkey, {}).get((gv, sv), 0), 2) for gv in group_vals]
                datasets_out.append((f"{metric_label} - {sv}", vals))
    return group_vals, datasets_out


def _apply_sort_top_n(
    pairs: list[tuple[str, float]],
    sort_order: str,
    top_n: int | None,
    time_order: bool,
) -> list[tuple[str, float]]:
    """排序並截斷 top_n"""
    if time_order:
        pairs = sorted(pairs, key=lambda p: _time_sort_key(p[0]))
    else:
        rev = (sort_order or "desc").lower() == "desc"
        pairs = sorted(pairs, key=lambda p: p[1], reverse=rev)
    if top_n is not None and top_n > 0:
        pairs = pairs[:top_n]
    return pairs


def _to_pie_percent(pairs: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """將數值轉為百分比（總和為 100）"""
    total = sum(p[1] for p in pairs)
    if total <= 0:
        return pairs
    return [(lbl, round(100 * v / total, 2)) for lbl, v in pairs]


def compute_aggregate(
    rows: list[dict[str, Any]],
    group_by_column: str,
    value_column: str | None,
    aggregation: str,
    chart_type: str,
    *,
    series_by_column: str | None = None,
    filters: list[dict[str, Any]] | None = None,
    top_n: int | None = None,
    sort_order: str = "desc",
    time_order: bool = False,
    value_columns: list[str] | None = None,
    indicator: str | None = None,
    display_fields: list[str] | None = None,
    group_aliases: dict[str, list[str]] | None = None,
    value_aliases: dict[str, list[str]] | None = None,
) -> dict[str, Any] | None:
    """
    主入口：依 intent 參數對 rows 做彙總，回傳 chart 資料。
    filters：多組篩選 [{"column": str, "value": Any}, ...]，依序套用。event_date 用日期區間。
    indicator：複合指標，如 margin_rate/roi/arpu/discount_rate，需搭配 value_columns 兩欄。
    display_fields：用戶明確要求的項目，如 ["總毛利","總成本","ROI"]，過濾並排序輸出。
    """
    if not rows:
        return None
    # 無分組時（如「momo 的毛利率」單一總計），使用虛擬 group 視為單一彙總
    _SYNTHETIC_GROUP = "__total__"
    if not (group_by_column or "").strip():
        group_by_column = _SYNTHETIC_GROUP
        ind_key = (indicator or "").strip().lower()
        synth_label = _INDICATOR_LABELS.get(ind_key, "總計")
        work_rows = [{**r, _SYNTHETIC_GROUP: synth_label} for r in rows]
    else:
        work_rows = rows
    g_aliases = group_aliases or _FALLBACK_GROUP_ALIASES
    resolved = _resolve_columns(
        work_rows, group_by_column, value_column, value_columns, None, series_by_column,
        group_aliases=g_aliases, value_aliases=value_aliases or _FALLBACK_VALUE_ALIASES,
    )
    if not resolved:
        return None
    work = work_rows
    actual_keys = [k for k in work_rows[0].keys() if k and k.strip()]
    # 合併同欄位多條件為 OR（IN）：channel_id=momo + channel_id=PChome → channel_id IN [momo, PChome]
    merged: dict[str, list[Any]] = {}
    for f in (filters or []):
        col = f.get("column") if isinstance(f, dict) else None
        val = f.get("value") if isinstance(f, dict) else None
        if not col or val is None:
            continue
        col_str = str(col).strip()
        if col_str not in merged:
            merged[col_str] = []
        if isinstance(val, list):
            merged[col_str].extend(v for v in val if v is not None)
        else:
            merged[col_str].append(val)
    for col_str, vals in merged.items():
        if not vals:
            continue
        key = next((ak for ak in actual_keys if ak.strip() == col_str), None) or _find_matching_column(actual_keys, col_str, g_aliases)
        if key:
            val = vals[0] if len(vals) == 1 else vals
            work = _apply_filter(work, key, val, is_date_column=_is_date_column(col_str))
            if not work:
                logger.warning("filters 篩選後無資料: column=%r value=%r", col_str, val)
                return None
    chart_type_lower = (chart_type or "bar").lower()
    is_pie = chart_type_lower == "pie"
    if resolved.series_key:
        ind_check = (indicator or "").strip().lower()
        has_indicator_cols = ind_check in _INDICATOR_COLUMN_NAMES and all(
            any(k == c or c in k for k in resolved.value_keys)
            for c in _INDICATOR_COLUMN_NAMES[ind_check]
        )
        if has_indicator_cols:
            dfs = display_fields or []
            if not dfs:
                dfs = [_VALUE_DISPLAY_NAMES.get(vk, vk) for vk in resolved.value_keys] + [_INDICATOR_LABELS.get(ind_check, ind_check.upper())]
            group_vals, datasets = _aggregate_multi_series_with_metrics(
                work, resolved.group_key, resolved.series_key, resolved.value_keys, aggregation,
                indicator, dfs,
            )
        else:
            group_vals, datasets = _aggregate_multi_series(
                work, resolved.group_key, resolved.series_key, resolved.value_keys, aggregation
            )
        if time_order:
            group_vals = sorted(group_vals, key=_time_sort_key)
        out: dict[str, Any] = {
            "labels": group_vals,
            "datasets": [{"label": lbl, "data": data} for lbl, data in datasets],
        }
        return out

    # 複合指標：indicator + value_columns 兩欄
    ind = (indicator or "").strip().lower() if indicator else ""
    if ind in _COMPOUND_INDICATORS and len(resolved.value_keys) == 2:
        num_idx, denom_idx, as_pct = _COMPOUND_INDICATORS[ind]
        num_key = resolved.value_keys[num_idx]
        denom_key = resolved.value_keys[denom_idx]
        ind_pairs = _aggregate_indicator_ratio(work, resolved.group_key, num_key, denom_key, as_pct)
        # 單一總計時，一併回傳組成欄位（如「總毛利、總成本、ROI」三值）
        if resolved.group_key == "__total__":
            raw_pairs = _aggregate_multi_value(work, resolved.value_keys, aggregation)
            ind_label = _INDICATOR_LABELS.get(ind, ind.upper())
            ind_val = ind_pairs[0][1] if ind_pairs else 0.0
            pairs = raw_pairs + [(ind_label, ind_val)]
        else:
            pairs = ind_pairs
    elif len(resolved.value_keys) > 1 and not ind and resolved.group_key == "__total__":
        # 多欄位分別彙總（如「總毛利、總成本」）：每欄獨立 sum
        pairs = _aggregate_multi_value(work, resolved.value_keys, aggregation)
    else:
        pairs = _aggregate_single_series(work, resolved.group_key, resolved.value_keys, aggregation)
    pairs = _apply_sort_top_n(pairs, sort_order, top_n, time_order)
    if is_pie and not ind:
        pairs = _to_pie_percent(pairs)
    pairs = _apply_display_fields(pairs, display_fields or [])
    return {
        "labels": [p[0] for p in pairs],
        "data": [p[1] for p in pairs],
    }