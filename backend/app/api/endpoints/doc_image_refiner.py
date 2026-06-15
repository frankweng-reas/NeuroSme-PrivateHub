"""圖片→結構化MD API：設定管理與處理"""
import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.doc_image_config import DocImageConfig, DocImageHistory
from app.models.user import User
from app.services.agent_usage import log_agent_usage
from app.services.doc_image_service import process_image_to_markdown

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_FILE_BYTES = 30 * 1024 * 1024  # 30 MB


# ── Schemas ───────────────────────────────────────────────────────────────────

class ExtractionTopic(BaseModel):
    name: str
    hint: str = ""


class DocImageConfigCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    model: str = Field(default="")
    extraction_topics: list[ExtractionTopic] = Field(default_factory=list)


class DocImageConfigUpdate(BaseModel):
    name: str | None = None
    model: str | None = None
    extraction_topics: list[ExtractionTopic] | None = None


class DocImageConfigResponse(BaseModel):
    id: int
    name: str
    model: str
    extraction_topics: list[ExtractionTopic]
    created_at: str
    updated_at: str


class DocImageHistoryItem(BaseModel):
    id: int
    filename: str
    raw_text: str
    result_markdown: str
    status: str
    error_message: str | None
    created_at: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_tenant_id(current: User) -> str:
    tid = (current.tenant_id or "").strip()
    if not tid:
        raise HTTPException(status_code=403, detail="使用者未綁定租戶")
    return tid


def _config_to_resp(cfg: DocImageConfig) -> DocImageConfigResponse:
    return DocImageConfigResponse(
        id=cfg.id,
        name=cfg.name,
        model=cfg.model or "",
        extraction_topics=[ExtractionTopic(**t) for t in (cfg.extraction_topics or [])],
        created_at=cfg.created_at.isoformat() if cfg.created_at else "",
        updated_at=cfg.updated_at.isoformat() if cfg.updated_at else "",
    )


# ── Config CRUD ───────────────────────────────────────────────────────────────

@router.post("/image-config", response_model=DocImageConfigResponse, status_code=201, summary="建立圖片萃取設定")
def create_config(
    body: DocImageConfigCreate,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfg = DocImageConfig(
        tenant_id=tenant_id,
        user_id=current.id,
        name=body.name,
        model=body.model,
        extraction_topics=[t.model_dump() for t in body.extraction_topics],
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _config_to_resp(cfg)


@router.get("/image-config", response_model=list[DocImageConfigResponse], summary="列出圖片萃取設定")
def list_configs(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfgs = (
        db.query(DocImageConfig)
        .filter(DocImageConfig.tenant_id == tenant_id)
        .order_by(DocImageConfig.created_at.desc())
        .all()
    )
    return [_config_to_resp(c) for c in cfgs]


@router.put("/image-config/{config_id}", response_model=DocImageConfigResponse, summary="更新圖片萃取設定")
def update_config(
    config_id: int,
    body: DocImageConfigUpdate,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfg = db.query(DocImageConfig).filter(
        DocImageConfig.id == config_id,
        DocImageConfig.tenant_id == tenant_id,
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="設定不存在")
    if body.name is not None:
        cfg.name = body.name
    if body.model is not None:
        cfg.model = body.model
    if body.extraction_topics is not None:
        cfg.extraction_topics = [t.model_dump() for t in body.extraction_topics]
    db.commit()
    db.refresh(cfg)
    return _config_to_resp(cfg)


@router.delete("/image-config/{config_id}", status_code=204, summary="刪除圖片萃取設定")
def delete_config(
    config_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfg = db.query(DocImageConfig).filter(
        DocImageConfig.id == config_id,
        DocImageConfig.tenant_id == tenant_id,
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="設定不存在")
    db.delete(cfg)
    db.commit()


# ── Processing ────────────────────────────────────────────────────────────────

@router.post("/image-config/{config_id}/process", response_model=DocImageHistoryItem, summary="上傳圖片/PDF 並萃取結構化 MD")
async def process(
    config_id: int,
    file: UploadFile,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
    model: Annotated[str | None, Form()] = None,
):
    tenant_id = _get_tenant_id(current)
    cfg = db.query(DocImageConfig).filter(
        DocImageConfig.id == config_id,
        DocImageConfig.tenant_id == tenant_id,
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="設定不存在")
    if not cfg.extraction_topics:
        raise HTTPException(status_code=400, detail="請先設定萃取主題")
    # model 優先使用 form 傳入的值，其次用 config 儲存的值
    use_model = (model or "").strip() or (cfg.model or "").strip()
    if not use_model:
        raise HTTPException(status_code=400, detail="請在側邊欄選擇模型")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="檔案為空")
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"檔案過大（上限 {MAX_FILE_BYTES // 1024 // 1024} MB）")

    filename = file.filename or "document"
    content_type = (file.content_type or "application/octet-stream").lower()

    hist = DocImageHistory(
        config_id=config_id,
        tenant_id=tenant_id,
        user_id=current.id,
        filename=filename,
        model=use_model,
        status="success",
    )

    started_at = time.monotonic()
    try:
        result = await process_image_to_markdown(
            file_bytes=file_bytes,
            filename=filename,
            content_type=content_type,
            extraction_topics=cfg.extraction_topics,
            model=use_model,
            db=db,
            tenant_id=tenant_id,
        )
        hist.latency_ms = int((time.monotonic() - started_at) * 1000)
        hist.raw_text = result["raw_text"]
        hist.result_markdown = result["markdown"]
        if result.get("usage"):
            u = result["usage"]
            hist.prompt_tokens = u.get("prompt_tokens")
            hist.completion_tokens = u.get("completion_tokens")
            hist.total_tokens = u.get("total_tokens")
    except Exception as exc:
        hist.latency_ms = int((time.monotonic() - started_at) * 1000)
        logger.error("doc_image process error: %s", exc)
        hist.status = "error"
        hist.error_message = str(exc)
        hist.raw_text = ""
        hist.result_markdown = ""

    db.add(hist)
    db.commit()
    db.refresh(hist)

    log_agent_usage(
        db=db,
        agent_type="doc_image",
        tenant_id=tenant_id,
        user_id=current.id,
        model=hist.model,
        prompt_tokens=hist.prompt_tokens,
        completion_tokens=hist.completion_tokens,
        total_tokens=hist.total_tokens,
        latency_ms=hist.latency_ms,
        status=hist.status,
    )
    db.commit()

    if hist.status == "error":
        raise HTTPException(status_code=502, detail=hist.error_message)

    return DocImageHistoryItem(
        id=hist.id,
        filename=hist.filename,
        raw_text=hist.raw_text,
        result_markdown=hist.result_markdown,
        status=hist.status,
        error_message=hist.error_message,
        created_at=hist.created_at.isoformat() if hist.created_at else "",
    )


# ── History ───────────────────────────────────────────────────────────────────

@router.get("/image-config/{config_id}/history", response_model=list[DocImageHistoryItem], summary="取得處理歷史")
def list_history(
    config_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
    limit: int = 30,
):
    tenant_id = _get_tenant_id(current)
    cfg = db.query(DocImageConfig).filter(
        DocImageConfig.id == config_id,
        DocImageConfig.tenant_id == tenant_id,
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="設定不存在")

    items = (
        db.query(DocImageHistory)
        .filter(DocImageHistory.config_id == config_id)
        .order_by(DocImageHistory.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        DocImageHistoryItem(
            id=h.id,
            filename=h.filename,
            raw_text=h.raw_text,
            result_markdown=h.result_markdown,
            status=h.status,
            error_message=h.error_message,
            created_at=h.created_at.isoformat() if h.created_at else "",
        )
        for h in items
    ]


class UpdateHistoryMarkdownBody(BaseModel):
    result_markdown: str


@router.patch("/image-config/{config_id}/history/{history_id}", response_model=DocImageHistoryItem, summary="更新歷史 Markdown")
def update_history_markdown(
    config_id: int,
    history_id: int,
    body: UpdateHistoryMarkdownBody,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    h = db.query(DocImageHistory).filter(
        DocImageHistory.id == history_id,
        DocImageHistory.config_id == config_id,
        DocImageHistory.tenant_id == tenant_id,
    ).first()
    if not h:
        raise HTTPException(status_code=404, detail="記錄不存在")
    h.result_markdown = body.result_markdown
    db.commit()
    db.refresh(h)
    return DocImageHistoryItem(
        id=h.id,
        filename=h.filename,
        raw_text=h.raw_text,
        result_markdown=h.result_markdown,
        status=h.status,
        error_message=h.error_message,
        created_at=h.created_at.isoformat() if h.created_at else "",
    )


@router.delete("/image-config/{config_id}/history/{history_id}", status_code=204, summary="刪除歷史記錄")
def delete_history_item(
    config_id: int,
    history_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    h = db.query(DocImageHistory).filter(
        DocImageHistory.id == history_id,
        DocImageHistory.config_id == config_id,
        DocImageHistory.tenant_id == tenant_id,
    ).first()
    if not h:
        raise HTTPException(status_code=404, detail="記錄不存在")
    db.delete(h)
    db.commit()
