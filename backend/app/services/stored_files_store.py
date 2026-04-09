"""
本機 stored_files blob 路徑與寫入／刪除

- layout: {STORED_FILES_DIR}/{tenant_id}/{file_id}/blob
- 路徑與 app.core.config.settings.STORED_FILES_DIR 對齊（相對路徑則相對於 backend/）
"""
from __future__ import annotations

import logging
from pathlib import Path
from uuid import UUID

from app.core.config import settings

logger = logging.getLogger(__name__)

_BLOB_NAME = "blob"


def get_stored_files_base_dir() -> Path | None:
    """回傳絕對根目錄；未設定或空字串則 None。"""
    d = (settings.STORED_FILES_DIR or "").strip()
    if not d:
        return None
    p = Path(d)
    if not p.is_absolute():
        backend_root = Path(__file__).resolve().parents[2]
        p = (backend_root / d).resolve()
    return p


def storage_rel_path_for(tenant_id: str, file_id: UUID) -> str:
    """DB stored_files.storage_rel_path 與磁碟相對於根目錄之路徑。"""
    tid = (tenant_id or "").strip()
    if not tid:
        raise ValueError("tenant_id 不可為空")
    return f"{tid}/{file_id}/{_BLOB_NAME}"


def absolute_blob_path(tenant_id: str, file_id: UUID) -> Path:
    base = get_stored_files_base_dir()
    if base is None:
        raise RuntimeError("STORED_FILES_DIR 未設定或為空，無法解析檔案路徑")
    rel = storage_rel_path_for(tenant_id, file_id)
    return (base / rel).resolve()


def write_blob(tenant_id: str, file_id: UUID, data: bytes) -> Path:
    """寫入完整內容，建立目錄；回傳實際路徑。"""
    path = absolute_blob_path(tenant_id, file_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    logger.debug("stored file written path=%s size=%s", path, len(data))
    return path


def delete_blob_if_exists(tenant_id: str, file_id: UUID) -> bool:
    """刪除 blob；若父目錄為空則一併移除。回傳是否曾存在檔案。"""
    try:
        path = absolute_blob_path(tenant_id, file_id)
    except RuntimeError:
        return False
    if not path.is_file():
        return False
    path.unlink()
    try:
        path.parent.rmdir()
    except OSError:
        pass
    return True
