"""BiProjects API：建立、列表、更新、刪除商務分析專案"""
import copy
import csv
import io
import json
import logging
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.bi_project import BiProject
from app.models.bi_schema import BiSchema
from app.models.scheduled_file_import import ScheduledFileImport
from app.models.user import User
from app.schemas.bi_project import BiProjectCreate, BiProjectResponse, BiProjectUpdate
from app.services.bi_sources_utils import get_merged_csv_for_project
from app.services.csv_transform import transform_csv_to_schema
from app.services.duckdb_store import delete_project_duckdb, get_project_duckdb_path, get_project_duckdb_row_count, sync_project_csv_to_duckdb, sync_transformed_rows_to_duckdb
from app.services.permission import get_agent_ids_for_user, resolve_agent_catalog
from app.services.schema_loader import (
    bi_schema_columns_to_fields,
    build_csv_mapping_from_schema,
    load_schema_from_db,
)
from app.services.scheduled_file_import_service import ALLOWED_WATCH_BASE, trigger_import, validate_watch_path

logger = logging.getLogger(__name__)

_ENUM_VALUES_MAX = 10  # 超過此數量的 distinct 值視為高基數，不追蹤


class ImportCsvFileItem(BaseModel):
    file_name: str
    content: str


class ImportCsvBlockItem(BaseModel):
    """schema_id：bi_schemas 表主鍵 id（如 汽車業-01），勿傳顯示名稱 name。"""
    schema_id: str | None = None
    files: list[ImportCsvFileItem]


class ImportCsvRequest(BaseModel):
    blocks: list[ImportCsvBlockItem]

router = APIRouter()


def _to_response(p: BiProject) -> BiProjectResponse:
    return BiProjectResponse(
        project_id=p.project_id,
        project_name=p.project_name,
        project_desc=p.project_desc,
        created_at=p.created_at,
        conversation_data=p.conversation_data,
        schema_id=getattr(p, "schema_id", None),
        project_config=getattr(p, "project_config", None),
    )


def _parse_agent_id(agent_id: str, fallback_tenant_id: str) -> tuple[str, str]:
    """解析 agent_id：支援 tenant_id:id 或 僅 id"""
    if ":" in agent_id:
        tenant_id, aid = agent_id.split(":", 1)
        return tenant_id, aid
    return fallback_tenant_id, agent_id


def _check_agent_access(db: Session, user: User, agent_id: str) -> tuple[str, str]:
    """驗證使用者有權限存取該 agent，回傳 (tenant_id, 業務 agent_id)"""
    tenant_id, aid = _parse_agent_id(agent_id, user.tenant_id)
    if tenant_id != user.tenant_id:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    catalog = resolve_agent_catalog(db, aid)
    if not catalog:
        raise HTTPException(status_code=404, detail="Agent not found")
    allowed = get_agent_ids_for_user(db, user.id)
    if catalog.agent_id not in allowed:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    return tenant_id, catalog.agent_id


@router.post("/", response_model=BiProjectResponse)
def create_bi_project(
    body: BiProjectCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """新增商務分析專案"""
    tenant_id, agent_id = _check_agent_access(db, current, body.agent_id)

    name = (body.project_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="專案名稱不可為空")

    proj = BiProject(
        tenant_id=tenant_id,
        user_id=str(current.id),
        agent_id=agent_id,
        project_name=name,
        project_desc=(body.project_desc or "").strip() or None,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return _to_response(proj)


@router.get("/", response_model=list[BiProjectResponse])
def list_bi_projects(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得該 agent 的商務分析專案列表"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    projects = (
        db.query(BiProject)
        .filter(
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .order_by(BiProject.created_at.desc())
        .all()
    )
    return [_to_response(p) for p in projects]


@router.get("/all", response_model=list[BiProjectResponse])
def list_all_bi_projects(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """開發用：列出目前使用者所有 BI 專案（不限 agent），供 Pipeline Inspector 下拉選單使用。"""
    projects = (
        db.query(BiProject)
        .filter(BiProject.user_id == str(current.id))
        .order_by(BiProject.created_at.desc())
        .all()
    )
    return [_to_response(p) for p in projects]


@router.patch("/{project_id}", response_model=BiProjectResponse)
def update_bi_project(
    project_id: str,
    body: BiProjectUpdate,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新商務分析專案（名稱、描述、對話紀錄、schema_id）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    patch = body.model_dump(exclude_unset=True)
    if "project_name" in patch:
        name = (body.project_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="專案名稱不可為空")
        proj.project_name = name
    if "project_desc" in patch:
        proj.project_desc = (body.project_desc or "").strip() or None
    if "conversation_data" in patch:
        proj.conversation_data = body.conversation_data
    if "schema_id" in patch:
        raw = patch["schema_id"]
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            proj.schema_id = None
        else:
            schema_def = load_schema_from_db(str(raw).strip(), db)
            if not schema_def:
                raise HTTPException(
                    status_code=404,
                    detail=f"Schema「{raw}」不存在，請確認 bi_schemas 表已匯入",
                )
            canon = str(schema_def.get("id") or "").strip()
            if not canon:
                raise HTTPException(status_code=500, detail="Schema 設定異常：bi_schemas 列缺少主鍵 id")
            proj.schema_id = canon
    if "project_config" in patch:
        proj.project_config = body.project_config

    db.commit()
    db.refresh(proj)
    return _to_response(proj)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bi_project(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> None:
    """刪除商務分析專案（bi_sources 會因 CASCADE 一併刪除）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    pid = str(proj.project_id)
    # 連動刪除自動匯入設定（無 FK，由 API 層負責）
    db.query(ScheduledFileImport).filter(
        ScheduledFileImport.target_type == "bi_project",
        ScheduledFileImport.target_id == pid,
    ).delete(synchronize_session=False)
    db.delete(proj)
    db.commit()
    delete_project_duckdb(pid)


@router.post("/{project_id}/sync-duckdb", status_code=status.HTTP_200_OK)
def sync_duckdb(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """手動同步專案 CSV 至 DuckDB（若已啟用長存）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    db.expire_all()  # 強制從 DB 重讀，避免 session 快取舊資料
    merged = get_merged_csv_for_project(db, project_id)
    ok, row_count = sync_project_csv_to_duckdb(project_id, merged)
    msg = f"DuckDB 已同步 ({row_count} 筆)" if ok else "DuckDB 未啟用或同步失敗"
    path = get_project_duckdb_path(project_id)
    return {"ok": ok, "message": msg, "row_count": row_count, "path": str(path) if path else None}


def _detect_and_patch_enum_values(
    all_rows: list[dict[str, Any]],
    schema_def: dict[str, Any],
    schema_id: str,
    db: Session,
) -> None:
    """
    掃描 all_rows 中每個 dim 欄位的 distinct 值，並以 union 策略合併回 bi_schemas.schema_json。

    合併規則：
    - key 不存在 / null：首次分析
        - distinct ≤ N → 儲存為已知 enum list
        - distinct > N → 儲存為 [] (高基數標記)
    - [] 空陣列：已確認高基數，不再動
    - [...] 非空：與新 distinct 做 union
        - union ≤ N → 更新為 sorted union
        - union > N → 降為 [] (高基數標記)
    """
    if not all_rows or not schema_def:
        return

    columns: dict[str, Any] = schema_def.get("columns") or {}
    dim_fields = [
        field for field, meta in columns.items()
        if isinstance(meta, dict) and (meta.get("attr") or "dim").strip().lower() == "dim"
    ]
    if not dim_fields:
        return

    # 收集新資料中的 distinct 值（每個 dim 欄位）
    new_distinct: dict[str, set[str]] = {f: set() for f in dim_fields}
    for row in all_rows:
        for field in dim_fields:
            v = row.get(field)
            if v is not None and str(v).strip():
                new_distinct[field].add(str(v).strip())

    # 讀取現有 schema_json
    bi_schema_row = db.query(BiSchema).filter(BiSchema.id == schema_id).first()
    if not bi_schema_row or not bi_schema_row.schema_json:
        return

    schema_json: dict[str, Any] = copy.deepcopy(dict(bi_schema_row.schema_json))
    cols_json: dict[str, Any] = schema_json.get("columns") or {}
    changed = False

    for field in dim_fields:
        if field not in cols_json or not isinstance(cols_json[field], dict):
            continue

        current = cols_json[field].get("enum_values")  # None | [] | [...]
        new_vals = new_distinct[field]

        if current == []:
            # 已確認高基數，不再動
            continue

        if current is None:
            # 首次分析
            result: list[str] = sorted(new_vals) if len(new_vals) <= _ENUM_VALUES_MAX else []
        else:
            # union 合併
            merged = set(current) | new_vals
            result = sorted(merged) if len(merged) <= _ENUM_VALUES_MAX else []

        # 只在有實際變化時才標記 changed
        existing = cols_json[field].get("enum_values")
        if result != existing:
            cols_json[field]["enum_values"] = result
            changed = True

    if not changed:
        return

    schema_json["columns"] = cols_json
    bi_schema_row.schema_json = schema_json
    db.add(bi_schema_row)
    try:
        db.commit()
        logger.info("bi_schemas[%s] enum_values 已更新", schema_id)
    except Exception:
        db.rollback()
        logger.exception("更新 bi_schemas[%s] enum_values 失敗", schema_id)


def _patch_dim_time_samples(
    all_rows: list[dict[str, Any]],
    schema_def: dict[str, Any],
    schema_id: str,
    db: Session,
) -> None:
    """CSV 匯入後，將 dim_time 欄位的 schema sample 同步成實際儲存格式。

    csv_transform._parse_timestamp 會把各種日期格式正規化為 YYYY-MM-DD（或 YYYY-MM-DD HH:MM:SS）。
    若 schema 的 sample 仍是原始 CSV 格式（如 2026-03），LLM 會生成錯誤的 filter。
    此函數從轉換後的 all_rows 取第一個非空值，更新 schema sample，確保 LLM 看到正確格式。
    """
    if not all_rows or not schema_def:
        return

    columns: dict[str, Any] = schema_def.get("columns") or {}
    dim_time_fields = [
        field for field, meta in columns.items()
        if isinstance(meta, dict) and (meta.get("attr") or "").strip().lower() == "dim_time"
    ]
    if not dim_time_fields:
        return

    bi_schema_row = db.query(BiSchema).filter(BiSchema.id == schema_id).first()
    if not bi_schema_row or not bi_schema_row.schema_json:
        return

    schema_json: dict[str, Any] = copy.deepcopy(dict(bi_schema_row.schema_json))
    cols_json: dict[str, Any] = schema_json.get("columns") or {}
    changed = False

    for field in dim_time_fields:
        if field not in cols_json or not isinstance(cols_json[field], dict):
            continue

        # 從 all_rows 取第一個非空的轉換後值
        actual_sample: str | None = None
        for row in all_rows:
            v = row.get(field)
            if v is not None and str(v).strip():
                actual_sample = str(v).strip()
                break

        if not actual_sample:
            continue

        current_sample = cols_json[field].get("sample", "")
        if actual_sample != current_sample:
            cols_json[field]["sample"] = actual_sample
            changed = True
            logger.info(
                "bi_schemas[%s] %s sample 更新: %r → %r",
                schema_id, field, current_sample, actual_sample,
            )

    if not changed:
        return

    schema_json["columns"] = cols_json
    bi_schema_row.schema_json = schema_json
    db.add(bi_schema_row)
    try:
        db.commit()
        logger.info("bi_schemas[%s] dim_time sample 已更新", schema_id)
    except Exception:
        db.rollback()
        logger.exception("更新 bi_schemas[%s] dim_time sample 失敗", schema_id)


@router.post("/{project_id}/import-csv", status_code=status.HTTP_200_OK)
def import_csv_to_duckdb(
    project_id: str,
    body: ImportCsvRequest,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """依 mapping template 將 CSV 轉換為 Standard Schema 後匯入 DuckDB"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    all_rows: list[dict[str, Any]] = []
    schema_ids_used: list[str] = []
    schema_defs_by_id: dict[str, dict[str, Any]] = {}
    for block in body.blocks:
        if not block.files:
            continue
        if block.schema_id and block.schema_id.strip():
            # 新版：從 bi_schemas 載入，依 aliases 自動 mapping
            schema_def = load_schema_from_db(block.schema_id.strip(), db)
            if not schema_def:
                raise HTTPException(
                    status_code=404,
                    detail=f"Schema「{block.schema_id}」不存在，請確認 bi_schemas 表已匯入",
                )
            canonical_sid = str(schema_def.get("id") or "").strip()
            if not canonical_sid:
                raise HTTPException(
                    status_code=500,
                    detail="Schema 設定異常：bi_schemas 列缺少主鍵 id",
                )
            schema_ids_used.append(canonical_sid)
            schema_defs_by_id[canonical_sid] = schema_def
            columns = schema_def.get("columns")
            schema_fields = bi_schema_columns_to_fields(columns)
            if not schema_fields:
                raise HTTPException(
                    status_code=400,
                    detail=f"Schema「{block.schema_id}」未定義 columns",
                )
            for f in block.files:
                if not f.content or not f.content.strip():
                    continue
                try:
                    reader = csv.reader(io.StringIO(f.content.strip().split("\n")[0]))
                    csv_headers = [h.strip().strip('"') for row in reader for h in (row or [])]
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"無法讀取 CSV 表頭：{e}") from e
                if not csv_headers:
                    raise HTTPException(status_code=400, detail="CSV 表頭為空")
                mapping = build_csv_mapping_from_schema(csv_headers, schema_fields)
                try:
                    rows = transform_csv_to_schema(f.content, mapping, schema_fields)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e)) from e
                all_rows.extend(rows)
        else:
            raise HTTPException(
                status_code=400,
                detail="每個區塊需指定 schema_id",
            )

    if not all_rows:
        return {"ok": True, "message": "無有效資料可匯入", "row_count": 0}

    ok, row_count, err_detail = sync_transformed_rows_to_duckdb(project_id, all_rows)
    msg = f"DuckDB 已匯入 ({row_count} 筆)" if ok else f"DuckDB 匯入失敗：{err_detail}" if err_detail else "DuckDB 匯入失敗"
    out: dict[str, Any] = {"ok": ok, "message": msg, "row_count": row_count}
    if ok:
        # bi_projects.schema_id 僅存 bi_schemas 主鍵 id（若請求曾帶 name，此處已改為解析後的 id）
        unique = list(dict.fromkeys(schema_ids_used))
        if unique:
            chosen = unique[0]
            if len(unique) > 1:
                msg = f"{msg}（多區塊使用不同 schema，分析以「{chosen}」為準）"
                out["message"] = msg
            proj.schema_id = chosen
            db.add(proj)
            db.commit()
            db.refresh(proj)
            out["schema_id"] = chosen
        # 偵測 enum_values 並寫回 bi_schemas（失敗不影響主流程）
        for sid, sdef in schema_defs_by_id.items():
            try:
                _detect_and_patch_enum_values(all_rows, sdef, sid, db)
            except Exception:
                logger.exception("_detect_and_patch_enum_values 失敗（schema_id=%s），略過", sid)
            try:
                _patch_dim_time_samples(all_rows, sdef, sid, db)
            except Exception:
                logger.exception("_patch_dim_time_samples 失敗（schema_id=%s），略過", sid)
    return out


@router.get("/{project_id}/duckdb-status", status_code=status.HTTP_200_OK)
def get_duckdb_status(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """取得專案 DuckDB 資料筆數"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    row_count = get_project_duckdb_row_count(project_id)
    return {"row_count": row_count if row_count is not None else 0, "has_data": row_count is not None and row_count > 0}


@router.delete("/{project_id}/duckdb-data", status_code=status.HTTP_200_OK)
def clear_duckdb_data(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """清除專案 DuckDB 資料（保留 project，不刪除設定）"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    delete_project_duckdb(project_id)
    return {"ok": True, "message": "資料已清除"}


# ── 自動匯入設定 endpoints ────────────────────────────────────────────────────

@router.get("/auto-import-config", status_code=status.HTTP_200_OK)
def get_auto_import_base_config(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """回傳系統層級的自動匯入設定（如允許的 watch_path 根目錄），供前端顯示提示。"""
    _check_agent_access(db, current, agent_id)
    return {"allowed_watch_base": ALLOWED_WATCH_BASE}

_ADMIN_ROLES = {"admin", "super_admin"}
_MANAGER_ROLES = {"manager", "admin", "super_admin"}


def _require_project_access(
    db: Session,
    current: User,
    project_id: str,
    agent_id: str,
) -> BiProject:
    """驗證使用者對 project 有存取權，回傳 project 物件。"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)
    proj = (
        db.query(BiProject)
        .filter(
            BiProject.project_id == project_id,
            BiProject.user_id == str(current.id),
            BiProject.tenant_id == tenant_id,
            BiProject.agent_id == aid,
        )
        .first()
    )
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


def _sfi_to_dict(sfi: ScheduledFileImport) -> dict:
    return {
        "configured": True,
        "id": sfi.id,
        "watch_path": sfi.watch_path,
        "mode": sfi.mode,
        "interval_minutes": sfi.interval_minutes,
        "enabled": sfi.enabled,
        "last_import_status": sfi.last_import_status,
        "last_import_at": sfi.last_import_at.isoformat() if sfi.last_import_at else None,
        "last_import_rows": sfi.last_import_rows,
        "last_error": sfi.last_error,
        "created_at": sfi.created_at.isoformat() if sfi.created_at else None,
        "updated_at": sfi.updated_at.isoformat() if sfi.updated_at else None,
    }


@router.get("/{project_id}/auto-import", status_code=status.HTTP_200_OK)
def get_auto_import(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """取得自動匯入設定（project owner 或 manager+）。"""
    _require_project_access(db, current, project_id, agent_id)
    sfi = db.query(ScheduledFileImport).filter(
        ScheduledFileImport.target_type == "bi_project",
        ScheduledFileImport.target_id == project_id,
    ).first()
    if not sfi:
        return {"configured": False}
    return {"configured": True, **_sfi_to_dict(sfi)}


@router.put("/{project_id}/auto-import", status_code=status.HTTP_200_OK)
def set_auto_import(
    project_id: str,
    body: dict,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """新增或更新自動匯入設定（僅 admin / super_admin）。"""
    if current.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="需要 admin 以上角色才能設定自動匯入路徑")

    proj = _require_project_access(db, current, project_id, agent_id)

    watch_path = (body.get("watch_path") or "").strip()
    if not watch_path:
        raise HTTPException(status_code=400, detail="watch_path 必填")
    try:
        validate_watch_path(watch_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # 目錄不存在時自動建立（省去使用者手動 mkdir 的步驟）
    try:
        Path(watch_path).mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"無法建立目錄 {watch_path}：{e}") from e

    mode = (body.get("mode") or "replace").strip()
    if mode not in ("replace", "append"):
        raise HTTPException(status_code=400, detail="mode 必須為 replace 或 append")

    interval = int(body.get("interval_minutes") or 60)
    if interval <= 0:
        raise HTTPException(status_code=400, detail="interval_minutes 必須大於 0")

    enabled = bool(body.get("enabled", True))

    sfi = db.query(ScheduledFileImport).filter(
        ScheduledFileImport.target_type == "bi_project",
        ScheduledFileImport.target_id == project_id,
    ).first()

    if sfi:
        sfi.watch_path = watch_path
        sfi.mode = mode
        sfi.interval_minutes = interval
        sfi.enabled = enabled
        sfi.user_id = str(current.id)
    else:
        sfi = ScheduledFileImport(
            tenant_id=str(proj.tenant_id),
            agent_id=str(proj.agent_id),
            user_id=str(current.id),
            target_type="bi_project",
            target_id=project_id,
            watch_path=watch_path,
            mode=mode,
            interval_minutes=interval,
            enabled=enabled,
        )
        db.add(sfi)

    db.commit()
    db.refresh(sfi)
    return {"configured": True, **_sfi_to_dict(sfi)}


@router.patch("/{project_id}/auto-import/toggle", status_code=status.HTTP_200_OK)
def toggle_auto_import(
    project_id: str,
    body: dict,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """啟用或停用自動匯入（manager+）。"""
    if current.role not in _MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="需要 manager 以上角色")

    _require_project_access(db, current, project_id, agent_id)

    sfi = db.query(ScheduledFileImport).filter(
        ScheduledFileImport.target_type == "bi_project",
        ScheduledFileImport.target_id == project_id,
    ).first()
    if not sfi:
        raise HTTPException(status_code=404, detail="尚未設定自動匯入，請管理員先設定監控目錄")

    enabled = body.get("enabled")
    if enabled is None:
        raise HTTPException(status_code=400, detail="enabled 必填（true / false）")

    sfi.enabled = bool(enabled)
    db.commit()
    return {"enabled": sfi.enabled}


@router.post("/{project_id}/auto-import/trigger", status_code=status.HTTP_200_OK)
def trigger_auto_import(
    project_id: str,
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """手動立即執行一次自動匯入（manager+）。"""
    if current.role not in _MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="需要 manager 以上角色")

    _require_project_access(db, current, project_id, agent_id)

    sfi = db.query(ScheduledFileImport).filter(
        ScheduledFileImport.target_type == "bi_project",
        ScheduledFileImport.target_id == project_id,
    ).first()
    if not sfi:
        raise HTTPException(status_code=404, detail="尚未設定自動匯入，請管理員先設定監控目錄")

    try:
        trigger_import(sfi, db)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    db.refresh(sfi)
    return {"triggered": True, **_sfi_to_dict(sfi)}
