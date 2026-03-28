"""
compute_engine：intent v4.0 一律轉成參數化 SQL，由 DuckDB 執行後組出圖表資料。

非 v4.0 intent 一律明確拒絕，不做靜默 fallback。
"""
from __future__ import annotations

from typing import Any

from app.services.compute_engine_sql import run_sql_compute_engine_v4
from app.services.duckdb_store import resolve_duckdb_path


def run_compute_engine(
    duckdb_name: str,
    intent: dict[str, Any],
    schema_def: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None, dict[str, Any]]:
    """
    Intent v4.0 → SQL → DuckDB → chart_result。
    回傳 (chart_result, error_detail, debug)。

    非 v4.0 intent 直接回傳錯誤，不做舊版本 fallback。
    """
    if not schema_def or not isinstance(schema_def, dict):
        return None, "schema_def 必須為有效物件", {"sql_only": True, "sql_pushdown": False}

    from app.schemas.intent_v4 import is_intent_v4_payload
    if not is_intent_v4_payload(intent):
        return (
            None,
            "僅支援 Intent v4.0（需含 \"version\": \"4.0\"）。請確認意圖生成使用最新 prompt。",
            {"sql_only": True, "sql_pushdown": False, "intent_version": "unknown"},
        )

    path = resolve_duckdb_path((duckdb_name or "").strip())
    if path is None:
        return (
            None,
            f"找不到 DuckDB 檔案（名稱={duckdb_name!r}），請確認 DUCKDB_DATA_DIR 或絕對路徑",
            {"sql_only": True, "sql_pushdown": False},
        )
    return run_sql_compute_engine_v4(path, intent, schema_def, engine_version=40)
