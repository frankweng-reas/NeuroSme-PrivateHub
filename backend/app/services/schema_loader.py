"""Schema 配置載入：從 config/schemas/*.yaml 讀取，供 analysis_compute 使用"""
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def load_schema(schema_id: str) -> dict[str, Any] | None:
    """
    從 config/schemas/{schema_id}.yaml 讀取 schema 定義。
    回傳 { id, columns, group_aliases, value_aliases }，失敗則 None。
    """
    if not schema_id or not str(schema_id).strip():
        return None
    try:
        import yaml
    except ImportError:
        logger.warning("PyYAML 未安裝，無法載入 schema 配置")
        return None

    base = Path(__file__).resolve().parents[2]
    filename = f"{schema_id.strip()}.yaml"
    for root in (base.parent / "config" / "schemas", base / "config" / "schemas"):
        path = root / filename
        if path.exists():
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8"))
                if not isinstance(data, dict):
                    return None
                # 確保必要結構存在
                group_aliases = data.get("group_aliases") or {}
                value_aliases = data.get("value_aliases") or {}
                if not isinstance(group_aliases, dict):
                    group_aliases = {}
                if not isinstance(value_aliases, dict):
                    value_aliases = {}
                return {
                    "id": data.get("id", schema_id),
                    "columns": data.get("columns") or {},
                    "group_aliases": group_aliases,
                    "value_aliases": value_aliases,
                }
            except Exception as e:
                logger.debug("讀取 schema %s 失敗: %s", schema_id, e)
    return None
