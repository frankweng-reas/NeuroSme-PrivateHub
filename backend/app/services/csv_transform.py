"""
CSV 轉換：依 mapping 對應至 Standard Schema，並計算衍生欄位

- gross_amount = unit_price * quantity
- sales_amount = gross_amount - discount_amount
- gross_profit = sales_amount - cost_amount
"""
import io
from typing import Any

import pandas as pd


def _to_numeric(val: Any) -> float:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().replace(",", "")
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def _parse_timestamp(val: Any) -> str:
    """解析為「日期＋時間」格式：YYYY-MM-DD HH:MM:SS"""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    s = str(val).strip()
    if not s:
        return ""
    try:
        dt = pd.to_datetime(s)
        return dt.strftime("%Y-%m-%d %H:%M:%S") if hasattr(dt, "strftime") else s
    except Exception:
        return s


def transform_csv_to_schema(
    csv_content: str,
    mapping: dict[str, str],
    schema_fields: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    將 CSV 依 mapping 轉換為 Standard Schema 格式。
    mapping: { "csv_column_name": "schema_field_name" }
    schema_fields: 來自 load_bi_sales_schema()
    """
    if not csv_content or not csv_content.strip():
        return []

    schema_by_field = {f["field"]: f for f in schema_fields}
    reverse_mapping = {v: k for k, v in mapping.items() if v}  # schema_field -> csv_col

    try:
        df = pd.read_csv(io.StringIO(csv_content.strip()), encoding="utf-8-sig")
    except Exception:
        return []
    df.columns = [str(c).strip() for c in df.columns]

    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        out: dict[str, Any] = {}
        for field_def in schema_fields:
            field = field_def["field"]
            default = field_def.get("default")
            csv_col = reverse_mapping.get(field)
            if csv_col and csv_col in df.columns:
                val = row.get(csv_col)
                ftype = field_def.get("type", "str")
                if ftype == "num":
                    out[field] = _to_numeric(val)
                elif ftype == "timestamp":
                    out[field] = _parse_timestamp(val)
                else:
                    out[field] = "" if (val is None or (isinstance(val, float) and pd.isna(val))) else str(val).strip()
            else:
                if field_def.get("type") == "num":
                    out[field] = _to_numeric(default) if default is not None else 0.0
                elif field_def.get("type") == "timestamp":
                    out[field] = ""
                else:
                    out[field] = str(default) if default is not None else ""

        # 衍生欄位：若 mapping 有提供且非零則用，否則依公式計算
        unit_price = _to_numeric(out.get("unit_price", 0))
        quantity = _to_numeric(out.get("quantity", 1))
        discount_amount = _to_numeric(out.get("discount_amount", 0))
        cost_amount = _to_numeric(out.get("cost_amount", 0))
        gross_amount_mapped = _to_numeric(out.get("gross_amount", 0))
        sales_amount_mapped = _to_numeric(out.get("sales_amount", 0))
        gross_profit_mapped = _to_numeric(out.get("gross_profit", 0))

        gross_amount = gross_amount_mapped if gross_amount_mapped else unit_price * quantity
        sales_amount = sales_amount_mapped if sales_amount_mapped else gross_amount - discount_amount
        gross_profit = gross_profit_mapped if gross_profit_mapped else sales_amount - cost_amount

        out["gross_amount"] = gross_amount
        out["sales_amount"] = sales_amount
        out["gross_profit"] = gross_profit

        rows.append(out)

    return rows
