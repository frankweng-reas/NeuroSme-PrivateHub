"""
分析 compute flow（DuckDB 版）：LLM 產生 SQL → DuckDB 執行 → 圖表資料

架構：
  - parse_csv_to_df：CSV → pandas DataFrame
  - get_schema_summary：產生給 LLM 的 schema 摘要
  - execute_sql_to_chart：執行 SQL，轉為 chart 格式（支援 df 或長存 path）
"""
import io
import logging
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd

from app.services.duckdb_store import execute_sql_on_duckdb_file

logger = logging.getLogger(__name__)


def parse_csv_to_df(content: str) -> pd.DataFrame | None:
    """解析 CSV 字串為 pandas DataFrame。第一列為 header。數值欄位自動轉為 numeric。"""
    if not content or not content.strip():
        return None
    try:
        df = pd.read_csv(io.StringIO(content.strip()), encoding="utf-8-sig")
        df.columns = [str(c).strip() for c in df.columns]
        # 數值欄位（金額、數量等）轉為 numeric，避免 SUM 時出錯
        _NUMERIC_KEYWORDS = ("金額", "銷售額", "數量", "金額", "amount", "sales", "quantity", "price", "value")
        for col in df.columns:
            if any(kw in col for kw in _NUMERIC_KEYWORDS) and df[col].dtype == object:
                df[col] = pd.to_numeric(df[col].astype(str).str.replace(",", ""), errors="coerce")
        return df
    except Exception as e:
        logger.warning("parse_csv_to_df 失敗: %s", e)
        return None


# 欄位用途對照：讓 LLM 區分平台 vs 產品，避免「momo深度保濕精華液」被當成產品名
_COLUMN_PURPOSE = {
    "平台": ["平台", "通路", "channel", "platform", "銷售通路"],
    "產品": ["產品名稱", "產品", "商品名稱", "商品", "品名", "品項"],
    "時間": ["月份", "月份別", "時間", "日期", "年", "月"],
    "數值": ["銷售金額", "銷售額", "銷售數量", "金額", "數量", "amount", "sales", "quantity"],
}


def _infer_column_purpose(col: str) -> str:
    """依欄位名稱推斷用途"""
    c = col.strip().lower()
    for purpose, keywords in _COLUMN_PURPOSE.items():
        if any(kw.lower() in c or c in kw.lower() for kw in keywords):
            return purpose
    return "其他"


def get_schema_summary(df: pd.DataFrame) -> str:
    """產生給 LLM 的 schema 摘要，精簡格式：欄位(用途) + 範例"""
    if df is None or df.empty:
        return "無資料"
    cols = list(df.columns)
    purposes = {c: _infer_column_purpose(c) for c in cols}
    schema_line = ", ".join(f'"{c}"({purposes[c]})' for c in cols)
    sample = df.iloc[0] if len(df) > 0 else pd.Series()
    sample_str = ", ".join(str(sample.get(c, ""))[:20] for c in cols[:8])
    return f"schema: {schema_line}\n範例: {sample_str}"


def _validate_sql(sql: str, _allowed_columns: list[str]) -> bool:
    """驗證 SQL：僅 SELECT，禁止寫入與 DDL"""
    if not sql or not sql.strip():
        return False
    s = sql.strip().rstrip(";").strip().upper()
    if not s.startswith("SELECT"):
        return False
    forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE", "EXEC"]
    for w in forbidden:
        if w in s:
            return False
    return True


def _sql_result_to_chart(
    df: pd.DataFrame,
    chart_type: str = "bar",
) -> dict[str, Any]:
    """將 SQL 查詢結果轉為 chart 格式"""
    if df is None or df.empty:
        return {}
    cols = list(df.columns)
    if len(cols) < 2:
        return {}
    labels = df.iloc[:, 0].astype(str).tolist()
    if len(cols) == 2:
        data = pd.to_numeric(df.iloc[:, 1], errors="coerce").fillna(0).tolist()
        return {"labels": labels, "data": data, "chartType": chart_type or "bar"}
    datasets = []
    for c in cols[1:]:
        vals = pd.to_numeric(df[c], errors="coerce").fillna(0).tolist()
        datasets.append({"label": str(c), "data": vals})
    return {"labels": labels, "datasets": datasets, "chartType": chart_type or "line"}


def _to_pie_percent(labels: list[str], data: list[float]) -> tuple[list[str], list[float]]:
    """將數值轉為百分比"""
    total = sum(data)
    if total <= 0:
        return labels, data
    return labels, [round(100 * v / total, 2) for v in data]


def get_sql_result(
    df: pd.DataFrame | None,
    sql: str,
    duckdb_path: Path | None = None,
) -> list[dict[str, Any]]:
    """執行 SQL，回傳原始結果列（供前端顯示）。優先使用 duckdb_path。"""
    if not sql or not sql.strip():
        return []
    sql = sql.strip().rstrip(";").strip()
    if duckdb_path and duckdb_path.exists():
        result = execute_sql_on_duckdb_file(duckdb_path, sql)
        if result is None:
            return []
        return [{str(k): (None if pd.isna(v) else v) for k, v in row.items()} for _, row in result.iterrows()]
    if df is None or df.empty:
        return []
    try:
        conn = duckdb.connect()
        conn.register("data", df)
        result = conn.execute(sql).df()
        conn.close()
        return [{str(k): (None if pd.isna(v) else v) for k, v in row.items()} for _, row in result.iterrows()]
    except Exception as e:
        logger.warning("get_sql_result 失敗: %s", e)
        return []


def debug_sql_matching_rows(
    df: pd.DataFrame | None,
    sql: str,
    duckdb_path: Path | None = None,
) -> None:
    """將符合 SQL WHERE 的原始列寫入 log，供排查 SUM 來源（僅後端 log，不回傳）"""
    if not sql or "WHERE" not in sql.upper():
        return
    try:
        sql_upper = sql.upper()
        where_idx = sql_upper.find("WHERE")
        group_idx = sql_upper.find("GROUP BY")
        if where_idx < 0:
            return
        where_part = sql[where_idx : group_idx if group_idx > 0 else len(sql)].strip()
        select_sql = f"SELECT * FROM data {where_part}"
        if duckdb_path and duckdb_path.exists():
            result = execute_sql_on_duckdb_file(duckdb_path, select_sql)
            if result is None:
                return
        elif df is not None and not df.empty:
            conn = duckdb.connect()
            conn.register("data", df)
            result = conn.execute(select_sql).df()
            conn.close()
        else:
            return
        n = len(result) if result is not None else 0
        if n == 0:
            logger.info("SQL 符合 0 列，SUM 結果可能為 0 或異常")
        else:
            rows = result.to_dict(orient="records")
            logger.info("SQL 符合 %d 列，明細: %s", n, rows[:10] if n > 10 else rows)
    except Exception as e:
        logger.warning("debug_sql_matching_rows: %s", e)


def get_schema_summary_from_path(duckdb_path: Path) -> str:
    """從長存 DuckDB 檔取得 schema 摘要（與 get_schema_summary(df) 同格式）"""
    result = execute_sql_on_duckdb_file(duckdb_path, "SELECT * FROM data LIMIT 1")
    if result is None or result.empty:
        return "無資料"
    return get_schema_summary(result)


def execute_sql_to_chart(
    df: pd.DataFrame | None,
    sql: str,
    chart_type: str = "bar",
    as_pie_percent: bool = False,
    duckdb_path: Path | None = None,
) -> dict[str, Any] | None:
    """
    執行 DuckDB SQL，回傳 chart 資料。
    - df：in-memory 資料（duckdb_path 為 None 時使用）
    - duckdb_path：長存 DuckDB 檔路徑（優先使用）
    - sql：SELECT 語句，表名為 data
    """
    if not sql or not sql.strip():
        return None
    sql = sql.strip().rstrip(";").strip()

    if duckdb_path and duckdb_path.exists():
        result = execute_sql_on_duckdb_file(duckdb_path, sql)
        if result is None:
            return None
        allowed = list(result.columns) if not result.empty else []
    else:
        if df is None or df.empty:
            return None
        allowed = list(df.columns)
        try:
            conn = duckdb.connect()
            conn.register("data", df)
            result = conn.execute(sql).df()
            conn.close()
        except Exception as e:
            logger.warning("DuckDB 執行失敗: %s", e)
            return None

    if not _validate_sql(sql, allowed):
        logger.warning("SQL 驗證失敗: %s", sql[:100])
        return None
    out = _sql_result_to_chart(result, chart_type)
    if not out:
        return None
    if as_pie_percent and "data" in out:
        labels, data = _to_pie_percent(out["labels"], out["data"])
        out["labels"] = labels
        out["data"] = data
    return out
