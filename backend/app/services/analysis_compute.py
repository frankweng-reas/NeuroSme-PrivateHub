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
from datetime import date
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

# schema_def 為 None 時的 fallback 別名（支援 Sales Analytics schema）
_FALLBACK_GROUP_ALIASES: dict[str, list[str]] = {
    "平台": ["平台", "各平台", "通路", "store_name", "channel_id", "channel", "platform", "店"],
    "月份": ["月份", "月", "日期", "時間", "timestamp", "event_date", "month", "date"],
    "品類": ["品類", "類別", "category_l1", "category_l2", "大類", "中類"],
    "產品名稱": ["產品名稱", "產品", "品名", "item_name", "item"],
}
_FALLBACK_VALUE_ALIASES: dict[str, list[str]] = {
    "銷售金額": ["銷售金額", "銷售額", "金額", "sales_amount", "net_amount", "gross_amount", "營收", "售價總額", "revenue"],
    "銷售數量": ["銷售數量", "數量", "quantity"],
    "毛利": ["毛利", "gross_profit"],
    "營收": ["營收", "sales_amount", "net_amount", "revenue", "售價總額"],
    "成本": ["成本", "cost_amount", "預估成本"],
    "來客數": ["來客數", "人數", "guest_count"],
}


_HIERARCHY_SEP = "\x1f"


def _get_group_value(r: dict[str, Any], group_key: str, group_keys: list[str] | None) -> str:
    """取得分組值：單層用 group_key，多層用 group_keys 組成複合 key。"""
    if group_keys and len(group_keys) > 1:
        parts = [str(r.get(k, "") or "").strip() or "(空)" for k in group_keys]
        return _HIERARCHY_SEP.join(parts)
    return str(r.get(group_key, "") or "").strip() or "(空)"


def _parse_num(v: Any) -> float:
    """解析數值，支援千分位逗號"""
    if v is None or v == "":
        return 0.0
    try:
        return float(str(v).replace(",", "").replace(" ", ""))
    except (ValueError, TypeError):
        return 0.0


def _time_sort_key(s: str) -> tuple[int, int, int]:
    """將時間字串轉為 (year, month, sub) 用於排序。支援 YYYY、YYYY-MM、YYYY-Qn、YYYY-Wnn、YYYY-MM-DD"""
    s = str(s).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{4})-Q(\d{1,2})", s, re.I)
    if m:
        return (int(m.group(1)), int(m.group(2)) * 3, 0)  # Q1→3, Q2→6, Q3→9, Q4→12
    m = re.match(r"^(\d{4})-W(\d{1,2})", s, re.I)
    if m:
        return (int(m.group(1)), 0, int(m.group(2)))
    m = re.match(r"^(\d{4})-(\d{1,2})", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), 0)
    m = re.match(r"^(\d{4})$", s)
    if m:
        return (int(m.group(1)), 0, 0)
    m = re.match(r"^(\d{1,2})月", s)
    if m:
        return (0, int(m.group(1)), 0)
    months = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
    for name, num in months.items():
        if s.lower().startswith(name):
            return (0, num, 0)
    return (0, 0, 0)


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


def _like_match(pattern: str, cell: str) -> bool:
    """SQL LIKE 語意：% 為萬用字元（任意字元）。pattern 與 cell 皆先 normalize。"""
    pat = _normalize_for_match(pattern)
    c = _normalize_for_match(str(cell or ""))
    if not pat:
        return True
    parts = pat.split("%")
    if len(parts) == 1:
        return pat == c
    idx = 0
    for i, part in enumerate(parts):
        if not part:
            continue
        pos = c.find(part, idx)
        if pos < 0:
            return False
        if i == 0 and pos != 0:
            return False
        idx = pos + len(part)
    if parts[-1] and idx != len(c):
        return False
    return True


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


def _date_to_grain(date_val: Any, grain: str) -> str:
    """將日期轉為 time_grain 顆粒度：day 保持原樣，week→YYYY-Wnn，month→YYYY-MM，quarter→YYYY-Qn，year→YYYY"""
    if not date_val:
        return "(空)"
    parsed = _parse_date_safe(str(date_val))
    if not parsed:
        return str(date_val).strip() or "(空)"
    y, m, d = parsed
    g = (grain or "").strip().lower()
    if g == "year":
        return f"{y}"
    if g == "quarter":
        q = (m - 1) // 3 + 1
        return f"{y}-Q{q}"
    if g == "month":
        return f"{y}-{m:02d}"
    if g == "week":
        try:
            t = date(y, m, d)
            iso = t.isocalendar()
            return f"{iso[0]}-W{iso[1]:02d}"
        except (ValueError, TypeError):
            return f"{y}-{m:02d}-{d:02d}"
    # day 或未指定：保持原樣
    return f"{y}-{m:02d}-{d:02d}"


_TIME_GRAIN_BUCKET_COL = "__time_grain_bucket"

_DATE_COLUMN_NAMES: frozenset[str] = frozenset({"timestamp", "event_date", "event-date", "date", "月份", "month", "時間"})


def _indicator_str(indicator: Any) -> str:
    """indicator 為 str 或 list 時，回傳單一 string（供需要單一指標的邏輯使用）"""
    if isinstance(indicator, list) and indicator:
        return str(indicator[0]).strip().lower()
    return (indicator or "").strip().lower()


def _is_date_column(column: str) -> bool:
    """是否為日期欄位（用於 BETWEEN/>= <= 邏輯）"""
    c = (column or "").strip().lower()
    return c in _DATE_COLUMN_NAMES or "date" in c


def _apply_filter(
    rows: list[dict[str, Any]],
    filter_key: str,
    filter_value: Any,
    *,
    op: str = "==",
    is_date_column: bool = False,
) -> list[dict[str, Any]]:
    """依 filter_value 與 op 篩選 rows。op: ==, !=, >, <, >=, <=, like。日期區間維持現有邏輯，op 不影響。"""
    if not rows or not filter_key or filter_value is None:
        return rows
    op = (op or "==").strip().lower()

    if isinstance(filter_value, list):
        if is_date_column:
            # 日期欄位：多個區間為 OR，取聯集
            seen_ids: set[int] = set()
            result: list[dict[str, Any]] = []
            for v in filter_value:
                if v is None:
                    continue
                val_str = str(v).strip()
                if "/" in val_str and re.match(
                    r"^\d{4}[-/]?\d{1,2}[-/]?\d{1,2}\s*/\s*\d{4}[-/]?\d{1,2}[-/]?\d{1,2}",
                    val_str.replace(" ", ""),
                ):
                    parts = val_str.split("/", 1)
                    start_d = _parse_date_safe(parts[0].strip())
                    end_d = _parse_date_safe(parts[1].strip())
                    if start_d and end_d:
                        for r in rows:
                            if id(r) in seen_ids:
                                continue
                            cell = r.get(filter_key)
                            d = _parse_date_safe(str(cell) if cell is not None else "")
                            if d and start_d <= d <= end_d:
                                seen_ids.add(id(r))
                                result.append(r)
                else:
                    single_d = _parse_date_safe(val_str)
                    if single_d:
                        for r in rows:
                            if id(r) in seen_ids:
                                continue
                            if _parse_date_safe(str(r.get(filter_key, "") or "")) == single_d:
                                seen_ids.add(id(r))
                                result.append(r)
            return result
        if op == "!=":
            excluded = {_normalize_for_match(str(v)) for v in filter_value if v}
            return [r for r in rows if _normalize_for_match(str(r.get(filter_key, "") or "")) not in excluded]
        if op == "==":
            allowed_norm = {_normalize_for_match(str(v)) for v in filter_value if v}
            result = [r for r in rows if _normalize_for_match(str(r.get(filter_key, "") or "")) in allowed_norm]
            if not result:
                result = [r for r in rows if any(t in _normalize_for_match(str(r.get(filter_key, "") or "")) for t in allowed_norm)]
            return result
        if op == "like":
            result = []
            for r in rows:
                cell = str(r.get(filter_key, "") or "")
                if any(_like_match(str(v), cell) for v in filter_value if v):
                    result.append(r)
            return result
        return rows
    val_str = str(filter_value).strip()

    # 日期欄位：維持現有邏輯，op 不影響。value 為 start/end 時用 BETWEEN
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

    # 數值比較：op 明確指定，value 須為數字
    if op in (">", "<", ">=", "<="):
        try:
            threshold = float(str(filter_value).replace(",", "").strip())
        except (ValueError, TypeError):
            return rows
        result = []
        for r in rows:
            v = _parse_num(r.get(filter_key))
            if op == ">" and v > threshold:
                result.append(r)
            elif op == "<" and v < threshold:
                result.append(r)
            elif op == ">=" and v >= threshold:
                result.append(r)
            elif op == "<=" and v <= threshold:
                result.append(r)
        return result
    if op == "!=":
        try:
            threshold = float(str(filter_value).replace(",", "").strip())
        except (ValueError, TypeError):
            threshold = None
        if threshold is not None:
            return [r for r in rows if _parse_num(r.get(filter_key)) != threshold]
        # 字串 !=
        target_norm = _normalize_for_match(val_str)
        return [r for r in rows if _normalize_for_match(str(r.get(filter_key, "") or "")) != target_norm]
    if op == "like":
        return [r for r in rows if _like_match(val_str, str(r.get(filter_key, "") or ""))]
    # op == "=="（預設）
    target_norm = _normalize_for_match(val_str)
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
    group_keys: list[str]  # 多層時為 [cat_l1, cat_l2, item_name]，單層為 [group_key]
    value_keys: list[str]
    filter_key: str | None
    series_key: str | None


def _resolve_columns(
    rows: list[dict[str, Any]],
    group_by_column: str | list[str] | None,
    value_column: str | None,
    value_columns: list[str] | None,
    filter_column: str | None,
    series_by_column: str | None,
    *,
    group_aliases: dict[str, list[str]] | None = None,
    value_aliases: dict[str, list[str]] | None = None,
    error_out: list[str] | None = None,
) -> _ResolvedColumns | None:
    """
    將 intent 的欄位名稱解析為實際的 row keys。
    group_by_column 可為 str 或 list[str]（多層階級）。
    """
    if not rows:
        if error_out is not None:
            error_out.append("rows 為空")
        return None
    gb_raw = group_by_column
    gb_list: list[str] = []
    if isinstance(gb_raw, list):
        gb_list = [str(x).strip() for x in gb_raw if x]
    elif gb_raw and str(gb_raw).strip():
        gb_list = [str(gb_raw).strip()]
    if not gb_list:
        if error_out is not None:
            error_out.append("group_by_column 為空")
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
        msg = f"找不到 value 欄位: value_column={value_column!r} value_columns={value_columns!r}"
        logger.warning("%s", msg)
        if error_out is not None:
            error_out.append(msg)
        return None

    # group_keys（支援多層）
    group_keys: list[str] = []
    for gb in gb_list:
        k = next((ak for ak in actual_keys if ak.strip() == gb), None) or _find_matching_column(actual_keys, gb, g_aliases)
        if not k:
            msg = f"找不到 group_by 欄位: {gb!r}"
            logger.warning("%s", msg)
            if error_out is not None:
                error_out.append(msg)
            return None
        group_keys.append(k)
    group_key = group_keys[-1]

    # filter_key
    filter_key = None
    if filter_column:
        filter_key = _find_matching_column(actual_keys, filter_column, g_aliases) or (filter_column if filter_column in actual_keys else None)

    # series_key
    series_key = None
    if series_by_column:
        series_key = next((ak for ak in actual_keys if ak.strip() == series_by_column.strip()), None) or _find_matching_column(actual_keys, series_by_column, g_aliases)

    return _ResolvedColumns(group_key=group_key, group_keys=group_keys, value_keys=value_keys, filter_key=filter_key, series_key=series_key)


# =============================================================================
# Layer 3：彙總計算
# =============================================================================


def _compute_derived_indicator_rows(
    rows: list[dict[str, Any]],
    indicator_names: set[str],
    actual_keys: list[str],
    value_aliases: dict[str, list[str]],
) -> None:
    """
    對 rows 就地計算衍生指標（roi, margin_rate, arpu, discount_rate）並寫入每列。
    indicator_names: 需要計算的指標名，如 {"roi"}。
    """
    v_aliases = value_aliases or _FALLBACK_VALUE_ALIASES
    for ind in indicator_names:
        if ind not in _INDICATOR_COLUMN_NAMES:
            continue
        num_col, denom_col = _INDICATOR_COLUMN_NAMES[ind]
        num_key = next((ak for ak in actual_keys if ak.strip() == num_col), None) or _find_matching_column(actual_keys, num_col, v_aliases)
        denom_key = next((ak for ak in actual_keys if ak.strip() == denom_col), None) or _find_matching_column(actual_keys, denom_col, v_aliases)
        if not num_key or not denom_key:
            continue
        for r in rows:
            num_val = _parse_num(r.get(num_key))
            denom_val = _parse_num(r.get(denom_key))
            val = (num_val / denom_val) if denom_val != 0 else 0.0
            r[ind] = val


# 複合指標：indicator -> (分子索引, 分母索引, 是否顯示為百分比)
_COMPOUND_INDICATORS: dict[str, tuple[int, int, bool]] = {
    "margin_rate": (0, 1, True),    # gross_profit / net_amount
    "roi": (0, 1, False),           # gross_profit / cost_amount
    "arpu": (0, 1, False),          # sales_amount / guest_count
    "discount_rate": (0, 1, True),  # discount_amount / net_amount
}
# 複合指標欄位名稱（用於 value_keys 多於 2 時依名稱找）。支援 sales_amount / net_amount。
_INDICATOR_COLUMN_NAMES: dict[str, tuple[str, str]] = {
    "margin_rate": ("gross_profit", "sales_amount"),   # 毛利/營收，fallback 會解析 net_amount
    "roi": ("gross_profit", "cost_amount"),
    "arpu": ("sales_amount", "guest_count"),           # 人均營收 = 營收 / 來客數
    "discount_rate": ("discount_amount", "sales_amount"),  # fallback 會解析 net_amount
}
def _get_indicator_keys(ind: str, value_keys: list[str]) -> tuple[str, str, bool] | None:
    """依欄位名稱解析 indicator 的 num_key, denom_key, as_percent。用於多 indicator 時。"""
    if ind not in _INDICATOR_COLUMN_NAMES or ind not in _COMPOUND_INDICATORS:
        return None
    num_col, denom_col = _INDICATOR_COLUMN_NAMES[ind]
    _, _, as_pct = _COMPOUND_INDICATORS[ind]
    num_key = next((k for k in value_keys if k.strip().lower() == num_col.lower() or num_col.lower() in k.strip().lower()), None)
    denom_key = next((k for k in value_keys if k.strip().lower() == denom_col.lower() or denom_col.lower() in k.strip().lower()), None)
    return (num_key, denom_key, as_pct) if num_key and denom_key else None


# 複合指標小數位數：arpu 客單價顯示整數
_INDICATOR_DECIMAL_PLACES: dict[str, int] = {"arpu": 0}
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
    "sales_amount": "銷售金額",
    "net_amount": "銷售金額",
    "quantity": "銷售數量",
    "discount_amount": "折扣金額",
    "guest_count": "來客數",
}
# 數值欄位對應的單位後綴（供 LLM 理解 data 含義）
_VALUE_SUFFIX: dict[str, str] = {
    "gross_profit": "元",
    "cost_amount": "元",
    "sales_amount": "元",
    "net_amount": "元",
    "discount_amount": "元",
    "quantity": "個",
    "guest_count": "人",
    "銷售金額": "元",
    "銷售數量": "個",
    "毛利": "元",
    "成本": "元",
    "來客數": "人",
}
# 各 dataset label 對應的 valueSuffix（多 series 時每筆 dataset 自帶單位）
_DATASET_LABEL_SUFFIX: dict[str, str] = {
    "毛利": "元",
    "成本": "元",
    "銷售金額": "元",
    "銷售數量": "個",
    "折扣金額": "元",
    "ROI": "",
    "毛利率": "%",
    "客單價": "元",
    "折扣率": "%",
}
# display_fields 對應：用戶輸入 -> 內部 label（用於過濾輸出）
_DISPLAY_FIELD_ALIASES: dict[str, list[str]] = {
    "毛利": ["毛利", "總毛利", "gross_profit"],
    "成本": ["成本", "總成本", "cost_amount"],
    "銷售金額": ["銷售金額", "總銷售金額", "sales_amount", "net_amount"],
    "ROI": ["ROI", "roi"],
    "毛利率": ["毛利率", "margin_rate"],
    "客單價": ["客單價", "arpu"],
    "折扣率": ["折扣率", "discount_rate"],
    "折扣金額": ["折扣金額", "discount_amount"],
    "銷售數量": ["銷售數量", "總銷售數量", "quantity"],
    "來客數": ["來客數", "人數", "guest_count"],
}


def _dataset_item(lbl: str, data: list[float]) -> dict[str, Any]:
    """單一 dataset 項目，含 label、data、valueLabel、valueSuffix。"""
    lbl_clean = (lbl or "").strip()
    suffix = _DATASET_LABEL_SUFFIX.get(lbl_clean, "")
    if not suffix and " - " in lbl_clean:
        for base, s in _DATASET_LABEL_SUFFIX.items():
            if lbl_clean.startswith(base + " - "):
                suffix = s
                break
    return {"label": lbl, "data": data, "valueLabel": lbl, "valueSuffix": suffix}


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


def _aggregate_indicator_plus_values_by_group(
    rows: list[dict[str, Any]],
    group_key: str,
    num_key: str,
    denom_key: str,
    as_percent: bool,
    extra_value_keys: list[str],
    aggregation: str,
    ind: str,
    group_keys: list[str] | None = None,
) -> tuple[list[str], list[tuple[str, list[float]]]]:
    """
    indicator + 額外 value 欄位，依 group 分組。
    回傳 (group_vals, datasets)，順序：indicator、extra1、extra2...
    """
    agg = (aggregation or "sum").lower()
    groups_num: dict[str, float] = {}
    groups_denom: dict[str, float] = {}
    pivots: dict[str, dict[str, float]] = {vk: {} for vk in extra_value_keys}
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        groups_num[gv] = groups_num.get(gv, 0) + _parse_num(r.get(num_key))
        groups_denom[gv] = groups_denom.get(gv, 0) + _parse_num(r.get(denom_key))
        for vk in extra_value_keys:
            val = 1.0 if agg == "count" else _parse_num(r.get(vk))
            pivots[vk][gv] = pivots[vk].get(gv, 0) + val
    group_vals = sorted(
        {g for g in groups_num} | {g for p in pivots.values() for g in p}
    )
    ind_label = _INDICATOR_LABELS.get(ind, ind.upper())
    decimals = _INDICATOR_DECIMAL_PLACES.get((ind or "").strip().lower(), 4)
    datasets: list[tuple[str, list[float]]] = []
    vals = []
    for gv in group_vals:
        denom = groups_denom.get(gv, 0)
        num = groups_num.get(gv, 0)
        v = round(num / denom, decimals) if denom else 0.0
        if as_percent:
            v = round(v * 100, 2)
        vals.append(v)
    datasets.append((ind_label, vals))
    for vk in extra_value_keys:
        label = _VALUE_DISPLAY_NAMES.get(vk, vk)
        data = [round(pivots[vk].get(gv, 0), 2) for gv in group_vals]
        datasets.append((label, data))
    return group_vals, datasets


def _aggregate_indicator_ratio(
    rows: list[dict[str, Any]],
    group_key: str,
    num_key: str,
    denom_key: str,
    as_percent: bool,
    group_keys: list[str] | None = None,
    indicator: str | None = None,
) -> list[tuple[str, float]]:
    """複合指標：依 group 分組，每組 sum(num)/sum(denom)。as_percent 時 ×100"""
    groups_num: dict[str, float] = {}
    groups_denom: dict[str, float] = {}
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        groups_num[gv] = groups_num.get(gv, 0) + _parse_num(r.get(num_key))
        groups_denom[gv] = groups_denom.get(gv, 0) + _parse_num(r.get(denom_key))
    decimals = _INDICATOR_DECIMAL_PLACES.get((indicator or "").strip().lower(), 4)
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
                val = round(val, decimals)
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


def _aggregate_multi_value_by_group(
    rows: list[dict[str, Any]],
    group_key: str,
    value_keys: list[str],
    aggregation: str,
    group_keys: list[str] | None = None,
) -> tuple[list[str], list[tuple[str, list[float]]]]:
    """
    多 value 欄位分別彙總，依 group_key 分組。
    回傳 (group_vals, [(series_label, [val per group]), ...])
    """
    agg = (aggregation or "sum").lower()
    pivots: dict[str, dict[str, float]] = {vk: {} for vk in value_keys}
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        for vk in value_keys:
            val = 1.0 if agg == "count" else _parse_num(r.get(vk))
            pivots[vk][gv] = pivots[vk].get(gv, 0) + val
    group_vals = sorted({g for p in pivots.values() for g in p.keys()})
    if agg == "avg":
        counts: dict[str, int] = {}
        for r in rows:
            gv = _get_group_value(r, group_key, group_keys)
            counts[gv] = counts.get(gv, 0) + 1
        for vk in pivots:
            for gv in pivots[vk]:
                if counts.get(gv, 0) > 0:
                    pivots[vk][gv] = pivots[vk][gv] / counts[gv]
    datasets: list[tuple[str, list[float]]] = []
    for vk in value_keys:
        label = _VALUE_DISPLAY_NAMES.get(vk, vk)
        data = [round(pivots[vk].get(gv, 0), 2) for gv in group_vals]
        datasets.append((label, data))
    return group_vals, datasets


def _aggregate_single_series(
    rows: list[dict[str, Any]],
    group_key: str,
    value_keys: list[str],
    aggregation: str,
    group_keys: list[str] | None = None,
) -> list[tuple[str, float]]:
    """單一系列：依 group_key 分組，對 value_keys 彙總。回傳 [(label, value), ...]"""
    groups: dict[str, float] = {}
    agg = (aggregation or "sum").lower()
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        val = 1.0 if agg == "count" else sum(_parse_num(r.get(k)) for k in value_keys)
        groups[gv] = groups.get(gv, 0) + val
    if agg == "avg" and groups:
        counts: dict[str, float] = {}
        for r in rows:
            gv = _get_group_value(r, group_key, group_keys)
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
    group_keys: list[str] | None = None,
) -> tuple[list[str], list[tuple[str, list[float]]]]:
    """多系列：pivot[(group_val, series_val)] = value。回傳 (labels, [(series_label, [vals])])"""
    pivot: dict[tuple[str, str], float] = {}
    agg = (aggregation or "sum").lower()
    for r in rows:
        gv = _get_group_value(r, group_key, group_keys)
        sv = str(r.get(series_key, "") or "").strip() or "(空)"
        val = sum(_parse_num(r.get(k)) for k in value_keys)
        if agg == "count":
            val = 1.0
        key = (gv, sv)
        pivot[key] = pivot.get(key, 0) + val
    if agg == "avg":
        counts: dict[tuple[str, str], float] = {}
        for r in rows:
            gv = _get_group_value(r, group_key, group_keys)
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
    group_keys: list[str] | None = None,
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
        gv = _get_group_value(r, group_key, group_keys)
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
    ind_decimals = _INDICATOR_DECIMAL_PLACES.get((ind or "").strip().lower(), 4)
    datasets_out: list[tuple[str, list[float]]] = []
    for metric_label, mtype, mkey in metrics_to_show:
        for sv in series_vals:
            if mtype == "indicator" and num_key and denom_key:
                vals = []
                for gv in group_vals:
                    denom = pivot_ind_denom.get((gv, sv), 0)
                    vals.append(round(pivot_ind_num.get((gv, sv), 0) / denom, ind_decimals) if denom else 0.0)
                datasets_out.append((f"{metric_label} - {sv}", vals))
            elif mtype == "value":
                vals = [round(pivots.get(mkey, {}).get((gv, sv), 0), 2) for gv in group_vals]
                datasets_out.append((f"{metric_label} - {sv}", vals))
    return group_vals, datasets_out


def _resolve_having_column_to_values(
    column: str,
    group_vals: list[str],
    datasets: list[tuple[str, list[float]]] | None,
    pairs: list[tuple[str, float]] | None,
    value_keys: list[str],
    indicator: str | None,
    is_total: bool = False,
) -> list[float] | None:
    """將 having_filter 的 column 解析為對應的數值序列，與 group_vals 同序。"""
    col_lower = (column or "").strip().lower()
    if not col_lower:
        return None
    if pairs is not None:
        if is_total:
            for lbl, v in pairs:
                if col_lower == (lbl or "").strip().lower():
                    return [v]
            for ind_name, ind_label in _INDICATOR_LABELS.items():
                if col_lower == ind_name or col_lower == (ind_label or "").strip().lower():
                    for lbl, v in pairs:
                        if (lbl or "").strip() == ind_label:
                            return [v]
            for label, aliases in _DISPLAY_FIELD_ALIASES.items():
                alist = aliases if isinstance(aliases, list) else [aliases]
                if col_lower in [str(a).strip().lower() for a in alist]:
                    for lbl, v in pairs:
                        if (lbl or "").strip() == label:
                            return [v]
            for vk in value_keys:
                if col_lower == vk.strip().lower():
                    lbl = _VALUE_DISPLAY_NAMES.get(vk, vk)
                    for l, v in pairs:
                        if (l or "").strip() == lbl:
                            return [v]
            return None
        return [p[1] for p in pairs]
    if datasets is None:
        return None
    for label, data in datasets:
        lbl = (label or "").strip().lower()
        if col_lower == lbl:
            return data
    for vk in value_keys:
        if col_lower == vk.strip().lower():
            lbl = _VALUE_DISPLAY_NAMES.get(vk, vk)
            for label, data in datasets:
                if (label or "").strip() == lbl:
                    return data
    for ind_name, ind_label in _INDICATOR_LABELS.items():
        if col_lower == ind_name or col_lower == (ind_label or "").strip().lower():
            for label, data in datasets:
                if (label or "").strip() == ind_label:
                    return data
    for label, aliases in _DISPLAY_FIELD_ALIASES.items():
        alist = aliases if isinstance(aliases, list) else [aliases]
        if col_lower in [str(a).strip().lower() for a in alist]:
            for lbl, data in datasets:
                if (lbl or "").strip() == label:
                    return data
    return None


def _apply_having_filters(
    group_vals: list[str],
    having_filters: list[dict[str, Any]],
    *,
    datasets: list[tuple[str, list[float]]] | None = None,
    pairs: list[tuple[str, float]] | None = None,
    value_keys: list[str] | None = None,
    indicator: str | None = None,
    is_total: bool = False,
) -> list[int]:
    """依 having_filters 篩選彙總結果，回傳保留的索引。依 column 從 datasets 或 pairs 解析數值。"""
    if not having_filters:
        return list(range(len(group_vals)))
    n = len(group_vals)
    keep = set(range(n))
    for hf in having_filters:
        if not isinstance(hf, dict):
            continue
        col = (hf.get("column") or "").strip()
        op = (hf.get("op") or "==").strip().lower() or "=="
        val = hf.get("value")
        if not col:
            continue
        try:
            threshold = float(str(val).replace(",", "").strip())
        except (ValueError, TypeError):
            continue
        col_lower = col.strip().lower()
        if col_lower in ("margin_rate", "discount_rate", "毛利率", "折扣率") and 0 < threshold < 1:
            threshold = threshold * 100
        vals = _resolve_having_column_to_values(col, group_vals, datasets, pairs, value_keys or [], indicator, is_total)
        if vals is None or len(vals) != n:
            continue
        still_keep: set[int] = set()
        for i in keep:
            v = vals[i] if i < len(vals) else 0.0
            if op == ">" and v > threshold:
                still_keep.add(i)
            elif op == "<" and v < threshold:
                still_keep.add(i)
            elif op == ">=" and v >= threshold:
                still_keep.add(i)
            elif op == "<=" and v <= threshold:
                still_keep.add(i)
            elif op == "==" and abs(v - threshold) <= 1e-9:
                still_keep.add(i)
            elif op == "!=" and abs(v - threshold) > 1e-9:
                still_keep.add(i)
        keep = still_keep
    return sorted(keep)


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
    group_by_column: str | list[str],
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
    indicator: str | list[str] | None = None,
    display_fields: list[str] | None = None,
    having_filters: list[dict[str, Any]] | None = None,
    time_grain: str | None = None,
    group_aliases: dict[str, list[str]] | None = None,
    value_aliases: dict[str, list[str]] | None = None,
    error_out: list[str] | None = None,
) -> dict[str, Any] | None:
    """
    主入口：依 intent 參數對 rows 做彙總，回傳 chart 資料。
    filters：維度篩選（彙總前）。having_filters：結果篩選（彙總後，如營收>100萬、ROI<1.5）。
    indicator：複合指標，如 margin_rate/roi/arpu/discount_rate，需搭配 value_columns 兩欄。
    display_fields：用戶明確要求的項目，過濾並排序輸出。
    """
    if not rows:
        if error_out is not None:
            error_out.append("rows 為空")
        return None
    # 無分組時：單一總計
    _SYNTHETIC_GROUP = "__total__"
    gb_empty = False
    if isinstance(group_by_column, list):
        gb_empty = not group_by_column or not any(str(x).strip() for x in group_by_column)
    else:
        gb_empty = not (group_by_column or "").strip()
    if gb_empty:
        group_by_column = _SYNTHETIC_GROUP
        ind_key = _indicator_str(indicator)
        synth_label = _INDICATOR_LABELS.get(ind_key, "總計")
        work_rows = [{**r, _SYNTHETIC_GROUP: synth_label} for r in rows]
    else:
        work_rows = rows
        # time_grain：當 group_by 為單一日期欄位時，依月/季/年彙總
        gb_single = (
            group_by_column if isinstance(group_by_column, str) else
            (group_by_column[0] if isinstance(group_by_column, list) and len(group_by_column) == 1 else None)
        )
        grain = (time_grain or "").strip().lower()
        if gb_single and grain in ("day", "week", "month", "quarter", "year") and _is_date_column(gb_single):
            actual_keys = [k for k in work_rows[0].keys() if k and k.strip()]
            g_aliases_pre = group_aliases or _FALLBACK_GROUP_ALIASES
            date_col = (
                next((ak for ak in actual_keys if ak.strip() == gb_single.strip()), None)
                or _find_matching_column(actual_keys, gb_single, g_aliases_pre)
            )
            if date_col:
                work_rows = [
                    {**r, _TIME_GRAIN_BUCKET_COL: _date_to_grain(r.get(date_col), grain)}
                    for r in work_rows
                ]
                group_by_column = _TIME_GRAIN_BUCKET_COL
    g_aliases = group_aliases or _FALLBACK_GROUP_ALIASES
    resolved = _resolve_columns(
        work_rows, group_by_column, value_column, value_columns, None, series_by_column,
        group_aliases=g_aliases, value_aliases=value_aliases or _FALLBACK_VALUE_ALIASES,
        error_out=error_out,
    )
    if not resolved:
        if error_out is not None and not error_out:
            error_out.append(f"_resolve_columns 失敗: group_by={group_by_column!r} value_columns={value_columns!r}")
        return None
    work = work_rows
    actual_keys = [k for k in work_rows[0].keys() if k and k.strip()]
    # 依 (column, op) 合併：op=="==" 時同欄位 OR（IN）；op=="!=" 時 NOT IN
    merged: dict[tuple[str, str], list[Any]] = {}
    for f in (filters or []):
        col = f.get("column") if isinstance(f, dict) else None
        val = f.get("value") if isinstance(f, dict) else None
        op = (f.get("op") or "==") if isinstance(f, dict) else "=="
        if col is None or val is None:
            continue
        col_str = str(col).strip()
        op_str = str(op).strip().lower() or "=="
        key = (col_str, op_str)
        if key not in merged:
            merged[key] = []
        if isinstance(val, list):
            merged[key].extend(v for v in val if v is not None)
        else:
            merged[key].append(val)
    # 若 filter 含衍生指標（roi, margin_rate 等），先計算並寫入 rows
    indicator_filter_cols = {
        c.strip().lower() for (c, _) in merged
        if c and c.strip().lower() in _INDICATOR_COLUMN_NAMES
    }
    if indicator_filter_cols:
        _compute_derived_indicator_rows(
            work, indicator_filter_cols, actual_keys,
            value_aliases or _FALLBACK_VALUE_ALIASES,
        )
        actual_keys = [k for k in work[0].keys() if k and k.strip()]
    for (col_str, op_str), vals in merged.items():
        if not vals:
            continue
        key = (
            next((ak for ak in actual_keys if ak.strip().lower() == col_str.strip().lower()), None)
            or _find_matching_column(actual_keys, col_str, g_aliases)
        )
        if key:
            val = vals[0] if len(vals) == 1 else vals
            work = _apply_filter(
                work, key, val, op=op_str, is_date_column=_is_date_column(col_str)
            )
            if not work:
                msg = f"filters 篩選後無資料: column={col_str!r} op={op_str!r} value={val!r}"
                logger.warning("%s", msg)
                if error_out is not None:
                    error_out.append(msg)
                return None
    chart_type_lower = (chart_type or "bar").lower()
    is_pie = chart_type_lower == "pie"
    gk = resolved.group_keys if len(resolved.group_keys) > 1 else None
    # 多層 group 時建立 hierarchy：composite_key -> {k: v for k in group_keys}
    hierarchy: dict[str, dict[str, Any]] = {}
    if gk:
        for r in work:
            gv = _get_group_value(r, resolved.group_key, gk)
            if gv not in hierarchy:
                hierarchy[gv] = {k: r.get(k) for k in gk}

    def _to_labels_and_details(group_vals: list[str]) -> tuple[list[Any], list[dict[str, Any]] | None]:
        """多層時：labels 用 leaf，並回傳 group_details；單層時 labels 即 group_vals，group_details 為 None"""
        if not gk:
            return group_vals, None
        details: list[dict[str, Any]] = []
        for gv in group_vals:
            d = hierarchy.get(gv)
            if d is None and _HIERARCHY_SEP in gv:
                parts = gv.split(_HIERARCHY_SEP)
                d = {k: (parts[i] if i < len(parts) else "") for i, k in enumerate(gk)}
            if d is None:
                d = {gk[-1]: gv}
            details.append(d)
        labels = [d.get(gk[-1], gv) for d, gv in zip(details, group_vals)]
        return labels, details

    if resolved.series_key:
        ind_check = _indicator_str(indicator)
        if ind_check in _INDICATOR_COLUMN_NAMES:
            nc, dc = _INDICATOR_COLUMN_NAMES[ind_check]
            num_ok = any(k == nc or nc in k for k in resolved.value_keys)
            denom_ok = any(k == dc or dc in k for k in resolved.value_keys)
            has_indicator_cols = num_ok and denom_ok
        else:
            has_indicator_cols = False
        if has_indicator_cols:
            dfs = display_fields or []
            if not dfs:
                dfs = [_VALUE_DISPLAY_NAMES.get(vk, vk) for vk in resolved.value_keys] + [_INDICATOR_LABELS.get(ind_check, ind_check.upper())]
            group_vals, datasets = _aggregate_multi_series_with_metrics(
                work, resolved.group_key, resolved.series_key, resolved.value_keys, aggregation,
                ind_check, dfs, group_keys=gk,
            )
        else:
            group_vals, datasets = _aggregate_multi_series(
                work, resolved.group_key, resolved.series_key, resolved.value_keys, aggregation,
                group_keys=gk,
            )
        if time_order:
            group_vals = sorted(group_vals, key=_time_sort_key)
        if having_filters:
            keep_idx = _apply_having_filters(
                group_vals, having_filters,
                datasets=datasets, value_keys=resolved.value_keys, indicator=indicator,
            )
            if keep_idx:
                group_vals = [group_vals[i] for i in keep_idx]
                datasets = [(lbl, [data[i] for i in keep_idx]) for lbl, data in datasets]
            else:
                group_vals, datasets = [], []
        labels, group_details = _to_labels_and_details(group_vals)
        out: dict[str, Any] = {
            "labels": labels,
            "datasets": [_dataset_item(lbl, data) for lbl, data in datasets],
        }
        if group_details is not None:
            out["groupDetails"] = group_details
        return out

    # 複合指標：indicator 可為 string 或 array
    def _normalize_indicator(indic: Any) -> list[str]:
        if isinstance(indic, list):
            return [str(x).strip().lower() for x in indic if x and str(x).strip().lower() in _COMPOUND_INDICATORS]
        if indic and str(indic).strip():
            i = str(indic).strip().lower()
            if i in _COMPOUND_INDICATORS:
                return [i]
        return []

    ind_list = _normalize_indicator(indicator)
    ind = ind_list[0] if len(ind_list) == 1 else ""

    # 多 indicator + 有 group：各自計算後合併 datasets
    if len(ind_list) > 1 and resolved.group_key != "__total__" and len(resolved.value_keys) >= 2:
        all_group_vals: set[str] = set()
        indicator_results: list[tuple[str, dict[str, float]]] = []
        for ind_name in ind_list:
            keys = _get_indicator_keys(ind_name, resolved.value_keys)
            if not keys:
                continue
            num_key, denom_key, as_pct = keys
            pairs = _aggregate_indicator_ratio(
                work, resolved.group_key, num_key, denom_key, as_pct, group_keys=gk, indicator=ind_name
            )
            gv_to_val = {gv: v for gv, v in pairs}
            all_group_vals.update(gv_to_val.keys())
            indicator_results.append((_INDICATOR_LABELS.get(ind_name, ind_name.upper()), gv_to_val))
        if not indicator_results:
            pass
        else:
            group_vals = sorted(all_group_vals)
            datasets = [(label, [gv_to_val.get(gv, 0.0) for gv in group_vals]) for label, gv_to_val in indicator_results]
            if display_fields:
                label_to_ds = {lbl: data for lbl, data in datasets}
                filtered: list[tuple[str, list[float]]] = []
                for df in display_fields:
                    df_clean = (df or "").strip()
                    if not df_clean:
                        continue
                    for label, aliases in _DISPLAY_FIELD_ALIASES.items():
                        if df_clean in aliases or df_clean == label:
                            if label in label_to_ds:
                                filtered.append((label, label_to_ds[label]))
                            break
                if filtered:
                    datasets = filtered
            if having_filters:
                keep_idx = _apply_having_filters(
                    group_vals, having_filters,
                    datasets=datasets, value_keys=resolved.value_keys, indicator=ind_list[0],
                )
                if keep_idx:
                    group_vals = [group_vals[i] for i in keep_idx]
                    datasets = [(lbl, [data[i] for i in keep_idx]) for lbl, data in datasets]
                else:
                    group_vals, datasets = [], []
            order_pairs = [(group_vals[i], datasets[0][1][i]) for i in range(len(group_vals))] if group_vals else []
            order_pairs = _apply_sort_top_n(order_pairs, sort_order, top_n, time_order)
            new_group_vals = [p[0] for p in order_pairs]
            gv_to_idx = {gv: i for i, gv in enumerate(group_vals)}
            new_datasets = [
                (lbl, [data[gv_to_idx[gv]] for gv in new_group_vals])
                for lbl, data in datasets
            ]
            labels, group_details = _to_labels_and_details(new_group_vals)
            out_multi: dict[str, Any] = {
                "labels": labels,
                "datasets": [_dataset_item(lbl, d) for lbl, d in new_datasets],
            }
            if group_details is not None:
                out_multi["groupDetails"] = group_details
            return out_multi

    # 單一 indicator：indicator + value_columns（至少 2 欄，第 3 欄起為額外彙總）
    if ind in _COMPOUND_INDICATORS and len(resolved.value_keys) >= 2:
        num_idx, denom_idx, as_pct = _COMPOUND_INDICATORS[ind]
        num_key = resolved.value_keys[num_idx]
        denom_key = resolved.value_keys[denom_idx]
        extra_keys = list(resolved.value_keys[2:]) if len(resolved.value_keys) > 2 else []
        # having_filters 若引用 value 欄位（如 net_amount），需一併彙總才能篩選
        if having_filters and resolved.group_key != "__total__":
            for hf in having_filters:
                if not isinstance(hf, dict):
                    continue
                col = (hf.get("column") or "").strip().lower()
                if not col:
                    continue
                for vk in resolved.value_keys:
                    if col == vk.strip().lower() and vk not in extra_keys:
                        extra_keys.append(vk)
                        break
                    lbl = (_VALUE_DISPLAY_NAMES.get(vk, vk) or "").strip().lower()
                    if lbl and col == lbl and vk not in extra_keys:
                        extra_keys.append(vk)
                        break
        if extra_keys and resolved.group_key != "__total__":
            group_vals, datasets = _aggregate_indicator_plus_values_by_group(
                work, resolved.group_key, num_key, denom_key, as_pct,
                extra_keys, aggregation, ind, group_keys=gk,
            )
            # display_fields 過濾要顯示的 series（與 multi_value_by_group 一致）
            if display_fields:
                label_to_ds = {lbl: data for lbl, data in datasets}
                filtered: list[tuple[str, list[float]]] = []
                for df in display_fields:
                    df_clean = (df or "").strip()
                    if not df_clean:
                        continue
                    for label, aliases in _DISPLAY_FIELD_ALIASES.items():
                        if df_clean in aliases or df_clean == label:
                            if label in label_to_ds:
                                filtered.append((label, label_to_ds[label]))
                            break
                if filtered:
                    datasets = filtered
            if having_filters:
                keep_idx = _apply_having_filters(
                    group_vals, having_filters,
                    datasets=datasets, value_keys=resolved.value_keys, indicator=ind,
                )
                if keep_idx:
                    group_vals = [group_vals[i] for i in keep_idx]
                    datasets = [(lbl, [data[i] for i in keep_idx]) for lbl, data in datasets]
                else:
                    group_vals, datasets = [], []
            order_pairs = [(group_vals[i], datasets[0][1][i]) for i in range(len(group_vals))] if group_vals else []
            order_pairs = _apply_sort_top_n(order_pairs, sort_order, top_n, time_order)
            new_group_vals = [p[0] for p in order_pairs]
            gv_to_idx = {gv: i for i, gv in enumerate(group_vals)}
            new_datasets = [
                (lbl, [data[gv_to_idx[gv]] for gv in new_group_vals])
                for lbl, data in datasets
            ]
            labels, group_details = _to_labels_and_details(new_group_vals)
            ret: dict[str, Any] = {
                "labels": labels,
                "datasets": [_dataset_item(lbl, d) for lbl, d in new_datasets],
            }
            if group_details is not None:
                ret["groupDetails"] = group_details
            return ret
        ind_pairs = _aggregate_indicator_ratio(
            work, resolved.group_key, num_key, denom_key, as_pct, group_keys=gk, indicator=ind
        )
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
    elif len(resolved.value_keys) > 1 and not ind:
        # 多 value 欄位 + 有 group：每欄位獨立彙總，回傳 datasets
        group_vals, datasets = _aggregate_multi_value_by_group(
            work, resolved.group_key, resolved.value_keys, aggregation, group_keys=gk,
        )
        # display_fields 過濾要顯示的 series
        if display_fields:
            label_to_ds = {lbl: data for lbl, data in datasets}
            filtered: list[tuple[str, list[float]]] = []
            for df in display_fields:
                df_clean = (df or "").strip()
                if not df_clean:
                    continue
                for label, aliases in _DISPLAY_FIELD_ALIASES.items():
                    if df_clean in aliases or df_clean == label:
                        if label in label_to_ds:
                            filtered.append((label, label_to_ds[label]))
                        break
            if filtered:
                datasets = filtered
        if having_filters:
            keep_idx = _apply_having_filters(
                group_vals, having_filters,
                datasets=datasets, value_keys=resolved.value_keys, indicator=None,
            )
            if keep_idx:
                group_vals = [group_vals[i] for i in keep_idx]
                datasets = [(lbl, [data[i] for i in keep_idx]) for lbl, data in datasets]
            else:
                group_vals, datasets = [], []
        # sort / top_n 依第一組 data 排序
        order_pairs = [(group_vals[i], datasets[0][1][i]) for i in range(len(group_vals))] if group_vals else []
        order_pairs = _apply_sort_top_n(order_pairs, sort_order, top_n, time_order)
        new_group_vals = [p[0] for p in order_pairs]
        gv_to_idx = {gv: i for i, gv in enumerate(group_vals)}
        new_datasets = [
            (lbl, [data[gv_to_idx[gv]] for gv in new_group_vals])
            for lbl, data in datasets
        ]
        labels, group_details = _to_labels_and_details(new_group_vals)
        ret2: dict[str, Any] = {
            "labels": labels,
            "datasets": [_dataset_item(lbl, d) for lbl, d in new_datasets],
        }
        if group_details is not None:
            ret2["groupDetails"] = group_details
        return ret2
    else:
        pairs = _aggregate_single_series(work, resolved.group_key, resolved.value_keys, aggregation, group_keys=gk)
    if having_filters and pairs:
        if resolved.group_key == "__total__":
            group_vals_p = ["__total__"]
            keep_idx = _apply_having_filters(
                group_vals_p, having_filters,
                pairs=pairs, value_keys=resolved.value_keys, indicator=ind, is_total=True,
            )
            if not keep_idx:
                pairs = []
        else:
            group_vals_p = [p[0] for p in pairs]
            keep_idx = _apply_having_filters(
                group_vals_p, having_filters,
                pairs=pairs, value_keys=resolved.value_keys, indicator=ind,
            )
            if keep_idx:
                keep_set = set(keep_idx)
                pairs = [p for i, p in enumerate(pairs) if i in keep_set]
            else:
                pairs = []
    pairs = _apply_sort_top_n(pairs, sort_order, top_n, time_order)
    if is_pie and not ind:
        pairs = _to_pie_percent(pairs)
    pairs = _apply_display_fields(pairs, display_fields or [])
    # 供 LLM 理解 data 含義
    if ind in _COMPOUND_INDICATORS:
        _, _, as_pct = _COMPOUND_INDICATORS[ind]
        value_label = _INDICATOR_LABELS.get(ind, ind)
        value_suffix = "%" if as_pct else ("元" if ind == "arpu" else "")
    elif aggregation == "count":
        value_label = "筆數"
        value_suffix = ""
    else:
        vk = resolved.value_keys[0] if resolved.value_keys else ""
        value_label = _VALUE_DISPLAY_NAMES.get(vk, vk)
        value_suffix = _VALUE_SUFFIX.get(vk, "")
    group_vals_from_pairs = [p[0] for p in pairs]
    labels, group_details = _to_labels_and_details(group_vals_from_pairs)
    out_final: dict[str, Any] = {
        "labels": labels,
        "data": [p[1] for p in pairs],
        "valueLabel": value_label,
        "valueSuffix": value_suffix,
    }
    if group_details is not None:
        out_final["groupDetails"] = group_details
    return out_final