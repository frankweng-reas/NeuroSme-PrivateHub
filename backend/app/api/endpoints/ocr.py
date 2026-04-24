"""OCR Agent API：設定管理、文件抽取、歷史記錄"""
import csv
import io
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.ocr_agent import OcrAgentConfig, OcrExtractionHistory
from app.models.user import User
from app.services.ocr_service import BUILTIN_TEMPLATES, extract_fields

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB
SUPPORTED_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp",
    "image/gif", "application/octet-stream",
}


# ── Schemas ───────────────────────────────────────────────────────────────────

class OutputField(BaseModel):
    name: str
    hint: str = ""


class OcrConfigCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    data_type_label: str = Field(default="", max_length=100)
    model: str = Field(default="")
    output_fields: list[OutputField] = Field(default_factory=list)


class OcrConfigUpdate(BaseModel):
    name: str | None = None
    data_type_label: str | None = None
    model: str | None = None
    output_fields: list[OutputField] | None = None


class OcrConfigResponse(BaseModel):
    id: int
    name: str
    data_type_label: str
    model: str
    output_fields: list[OutputField]
    created_at: str
    updated_at: str


class TokenUsage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class OcrHistoryItem(BaseModel):
    id: int
    filename: str
    raw_text: str
    extracted_fields: dict
    status: str
    error_message: str | None
    created_at: str
    usage: TokenUsage | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_tenant_id(current: User) -> str:
    tid = (current.tenant_id or "").strip()
    if not tid:
        raise HTTPException(status_code=403, detail="使用者未綁定租戶")
    return tid


def _config_to_resp(cfg: OcrAgentConfig) -> OcrConfigResponse:
    return OcrConfigResponse(
        id=cfg.id,
        name=cfg.name,
        data_type_label=cfg.data_type_label or "",
        model=cfg.model or "",
        output_fields=[OutputField(**f) for f in (cfg.output_fields or [])],
        created_at=cfg.created_at.isoformat() if cfg.created_at else "",
        updated_at=cfg.updated_at.isoformat() if cfg.updated_at else "",
    )


# ── Templates ─────────────────────────────────────────────────────────────────

@router.get("/templates", summary="取得內建 OCR 範本")
def list_templates():
    return BUILTIN_TEMPLATES


# ── Config CRUD ───────────────────────────────────────────────────────────────

@router.post("", response_model=OcrConfigResponse, status_code=201, summary="建立 OCR 設定")
def create_config(
    body: OcrConfigCreate,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfg = OcrAgentConfig(
        tenant_id=tenant_id,
        user_id=current.id,
        name=body.name,
        data_type_label=body.data_type_label,
        model=body.model,
        output_fields=[f.model_dump() for f in body.output_fields],
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _config_to_resp(cfg)


@router.get("", response_model=list[OcrConfigResponse], summary="列出 OCR 設定")
def list_configs(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfgs = (
        db.query(OcrAgentConfig)
        .filter(OcrAgentConfig.tenant_id == tenant_id)
        .order_by(OcrAgentConfig.created_at.desc())
        .all()
    )
    return [_config_to_resp(c) for c in cfgs]


@router.get("/{config_id}", response_model=OcrConfigResponse, summary="取得單一 OCR 設定")
def get_config(
    config_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfg = db.query(OcrAgentConfig).filter(
        OcrAgentConfig.id == config_id,
        OcrAgentConfig.tenant_id == tenant_id,
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="設定不存在")
    return _config_to_resp(cfg)


@router.put("/{config_id}", response_model=OcrConfigResponse, summary="更新 OCR 設定")
def update_config(
    config_id: int,
    body: OcrConfigUpdate,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfg = db.query(OcrAgentConfig).filter(
        OcrAgentConfig.id == config_id,
        OcrAgentConfig.tenant_id == tenant_id,
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="設定不存在")
    if body.name is not None:
        cfg.name = body.name
    if body.data_type_label is not None:
        cfg.data_type_label = body.data_type_label
    if body.model is not None:
        cfg.model = body.model
    if body.output_fields is not None:
        cfg.output_fields = [f.model_dump() for f in body.output_fields]
    db.commit()
    db.refresh(cfg)
    return _config_to_resp(cfg)


@router.delete("/{config_id}", status_code=204, summary="刪除 OCR 設定")
def delete_config(
    config_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfg = db.query(OcrAgentConfig).filter(
        OcrAgentConfig.id == config_id,
        OcrAgentConfig.tenant_id == tenant_id,
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="設定不存在")
    db.delete(cfg)
    db.commit()


# ── Extraction ────────────────────────────────────────────────────────────────

@router.post("/{config_id}/extract", response_model=OcrHistoryItem, summary="上傳文件並抽取欄位")
async def extract(
    config_id: int,
    file: UploadFile,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfg = db.query(OcrAgentConfig).filter(
        OcrAgentConfig.id == config_id,
        OcrAgentConfig.tenant_id == tenant_id,
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="設定不存在")

    if not cfg.output_fields:
        raise HTTPException(status_code=400, detail="請先設定輸出欄位")

    if not cfg.model:
        raise HTTPException(status_code=400, detail="請先選擇模型")

    content_type = (file.content_type or "application/octet-stream").lower()
    file_bytes = await file.read()

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="檔案為空")
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"檔案過大（上限 {MAX_FILE_BYTES // 1024 // 1024} MB）")

    filename = file.filename or "document"
    hist = OcrExtractionHistory(
        config_id=config_id,
        tenant_id=tenant_id,
        user_id=current.id,
        filename=filename,
        status="success",
    )

    try:
        result = await extract_fields(
            file_bytes=file_bytes,
            content_type=content_type,
            model=cfg.model,
            data_type_label=cfg.data_type_label or "",
            output_fields=cfg.output_fields,
            db=db,
            tenant_id=tenant_id,
        )
        hist.raw_text = result["raw_text"]
        hist.extracted_fields = result["extracted_fields"]
    except Exception as exc:
        logger.error("OCR extract error: %s", exc)
        hist.status = "error"
        hist.error_message = str(exc)
        hist.raw_text = ""
        hist.extracted_fields = {}
        result = {}

    db.add(hist)
    db.commit()
    db.refresh(hist)

    if hist.status == "error":
        raise HTTPException(status_code=502, detail=hist.error_message)

    token_usage: TokenUsage | None = None
    if result.get("usage"):
        u = result["usage"]
        token_usage = TokenUsage(
            prompt_tokens=u.get("prompt_tokens", 0),
            completion_tokens=u.get("completion_tokens", 0),
            total_tokens=u.get("total_tokens", 0),
        )

    return OcrHistoryItem(
        id=hist.id,
        filename=hist.filename,
        raw_text=hist.raw_text,
        extracted_fields=hist.extracted_fields,
        status=hist.status,
        error_message=hist.error_message,
        created_at=hist.created_at.isoformat() if hist.created_at else "",
        usage=token_usage,
    )


# ── History ───────────────────────────────────────────────────────────────────

@router.get("/{config_id}/history", response_model=list[OcrHistoryItem], summary="取得抽取歷史")
def list_history(
    config_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
    limit: int = 50,
):
    tenant_id = _get_tenant_id(current)
    cfg = db.query(OcrAgentConfig).filter(
        OcrAgentConfig.id == config_id,
        OcrAgentConfig.tenant_id == tenant_id,
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="設定不存在")

    items = (
        db.query(OcrExtractionHistory)
        .filter(OcrExtractionHistory.config_id == config_id)
        .order_by(OcrExtractionHistory.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        OcrHistoryItem(
            id=h.id,
            filename=h.filename,
            raw_text=h.raw_text,
            extracted_fields=h.extracted_fields or {},
            status=h.status,
            error_message=h.error_message,
            created_at=h.created_at.isoformat() if h.created_at else "",
        )
        for h in items
    ]


class UpdateHistoryFieldsBody(BaseModel):
    extracted_fields: dict[str, str | None]


@router.patch("/{config_id}/history/{history_id}", response_model=OcrHistoryItem, summary="更新歷史記錄的指定欄位值")
def update_history_fields(
    config_id: int,
    history_id: int,
    body: UpdateHistoryFieldsBody,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    h = db.query(OcrExtractionHistory).filter(
        OcrExtractionHistory.id == history_id,
        OcrExtractionHistory.config_id == config_id,
        OcrExtractionHistory.tenant_id == tenant_id,
    ).first()
    if not h:
        raise HTTPException(status_code=404, detail="記錄不存在")
    h.extracted_fields = body.extracted_fields
    db.commit()
    db.refresh(h)
    return OcrHistoryItem(
        id=h.id,
        filename=h.filename,
        raw_text=h.raw_text,
        extracted_fields=h.extracted_fields or {},
        status=h.status,
        error_message=h.error_message,
        created_at=h.created_at.isoformat() if h.created_at else "",
    )


@router.delete("/{config_id}/history/{history_id}", status_code=204, summary="刪除單筆歷史")
def delete_history_item(
    config_id: int,
    history_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    h = db.query(OcrExtractionHistory).filter(
        OcrExtractionHistory.id == history_id,
        OcrExtractionHistory.config_id == config_id,
        OcrExtractionHistory.tenant_id == tenant_id,
    ).first()
    if not h:
        raise HTTPException(status_code=404, detail="記錄不存在")
    db.delete(h)
    db.commit()


@router.get("/{config_id}/history/export/csv", summary="匯出歷史為 CSV")
def export_history_csv(
    config_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    cfg = db.query(OcrAgentConfig).filter(
        OcrAgentConfig.id == config_id,
        OcrAgentConfig.tenant_id == tenant_id,
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="設定不存在")

    items = (
        db.query(OcrExtractionHistory)
        .filter(
            OcrExtractionHistory.config_id == config_id,
            OcrExtractionHistory.status == "success",
        )
        .order_by(OcrExtractionHistory.created_at.asc())
        .all()
    )

    field_names = [f["name"] for f in (cfg.output_fields or [])]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["時間", "檔案名稱"] + field_names)
    for h in items:
        ef = h.extracted_fields or {}
        row = [
            h.created_at.strftime("%Y-%m-%d %H:%M") if h.created_at else "",
            h.filename,
        ] + [str(ef.get(fn, "")) for fn in field_names]
        writer.writerow(row)

    buf.seek(0)
    filename = f"ocr_{cfg.name}_{cfg.data_type_label}.csv"
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
