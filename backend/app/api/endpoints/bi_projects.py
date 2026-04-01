"""BiProjects API：建立、列表、更新、刪除商務分析專案"""
import copy
import csv
import io
import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.bi_project import BiProject
from app.models.bi_schema import BiSchema
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
    return BiProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        conversation_data=proj.conversation_data,
        schema_id=getattr(proj, "schema_id", None),
    )


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
    return [
        BiProjectResponse(
            project_id=p.project_id,
            project_name=p.project_name,
            project_desc=p.project_desc,
            created_at=p.created_at,
            conversation_data=p.conversation_data,
            schema_id=getattr(p, "schema_id", None),
        )
        for p in projects
    ]


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
    return [
        BiProjectResponse(
            project_id=p.project_id,
            project_name=p.project_name,
            project_desc=p.project_desc,
            created_at=p.created_at,
            conversation_data=p.conversation_data,
            schema_id=getattr(p, "schema_id", None),
        )
        for p in projects
    ]


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

    db.commit()
    db.refresh(proj)
    return BiProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
        conversation_data=proj.conversation_data,
        schema_id=getattr(proj, "schema_id", None),
    )


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
