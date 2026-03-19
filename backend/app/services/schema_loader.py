"""載入 Schema：load_schema(schema_id) 用於 chat compute；load_bi_sales_schema() 用於 Test01"""
import logging
from pathlib import Path
from typing import Any

import yaml

from app.core.config import settings

logger = logging.getLogger(__name__)

_SCHEMA_FILENAME = "bi_sales_table.yaml"


def _get_schemas_dir() -> Path | None:
    """取得 config/schemas 目錄路徑"""
    if settings.SCHEMA_CONFIG_DIR:
        p = Path(settings.SCHEMA_CONFIG_DIR).resolve()
        if p.exists():
            return p
    candidates = [
        Path(__file__).resolve().parents[3] / "config" / "schemas",
        Path(__file__).resolve().parents[2] / ".." / "config" / "schemas",
        Path.cwd().parent / "config" / "schemas",
        Path.cwd() / "config" / "schemas",
    ]
    for c in candidates:
        resolved = c.resolve()
        if resolved.exists():
            return resolved
    return None


def load_schema(schema_id: str) -> dict[str, Any] | None:
    """
    載入 config/schemas/{schema_id}.yaml，供 chat compute 使用。
    回傳 dict（含 id, group_aliases, value_aliases, columns 等）或 None。
    """
    if not schema_id or not str(schema_id).strip():
        return None
    base = _get_schemas_dir()
    if not base:
        return None
    path = base / f"{schema_id.strip()}.yaml"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if isinstance(data, dict):
            data.setdefault("id", schema_id)
            return data
        return None
    except (yaml.YAMLError, OSError) as e:
        logger.warning("Schema %s 載入失敗: %s", schema_id, e)
        return None


def _find_schema_path() -> Path | None:
    """尋找 bi_sales_table.yaml 路徑，支援多種執行環境"""
    if settings.SCHEMA_CONFIG_DIR:
        custom = Path(settings.SCHEMA_CONFIG_DIR).resolve() / _SCHEMA_FILENAME
        if custom.exists():
            return custom
    candidates = [
        # 從 backend/app/services 往上到專案根目錄
        Path(__file__).resolve().parents[3] / "config" / "schemas" / _SCHEMA_FILENAME,
        # 從 backend 目錄的父層（專案根）
        Path(__file__).resolve().parents[2] / ".." / "config" / "schemas" / _SCHEMA_FILENAME,
        # 從 cwd（若從 backend/ 執行 uvicorn）
        Path.cwd().parent / "config" / "schemas" / _SCHEMA_FILENAME,
        # 從 cwd（若從專案根執行）
        Path.cwd() / "config" / "schemas" / _SCHEMA_FILENAME,
    ]
    for p in candidates:
        resolved = p.resolve()
        if resolved.exists():
            return resolved
    return None


def load_bi_sales_schema() -> list[dict[str, Any]]:
    """載入 bi_sales_table.yaml，回傳欄位定義列表"""
    path = _find_schema_path()
    if not path:
        logger.warning("bi_sales_table.yaml 找不到，嘗試路徑: %s", Path(__file__).resolve().parents[3] / "config" / "schemas" / _SCHEMA_FILENAME)
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data if isinstance(data, list) else []
    except yaml.YAMLError as e:
        logger.exception("bi_sales_table.yaml 解析失敗: %s", e)
        return []
    except OSError as e:
        logger.exception("bi_sales_table.yaml 讀取失敗: %s", e)
        return []
