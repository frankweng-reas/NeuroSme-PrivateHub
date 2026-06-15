"""公開 Vision 轉錄 API：外部 App 透過 API Key 將圖片轉為文字

端點：POST /api/v1/public/vision/transcribe
認證：X-API-Key header
"""
import logging
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.api_key_auth import get_api_key
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.api_key import ApiKey, ApiKeyUsage
from app.services.document_structuring.llm_resolve import resolve_tenant_model
from app.services.image_text_service import recognize_text_from_image
from app.services.llm_caller import LLMCallError, LLMProviderNotConfigured

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB
SUPPORTED_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


class TokenUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class VisionTranscribeResponse(BaseModel):
    text: str
    format: Literal["markdown", "plain"] = "markdown"
    model: str = ""
    usage: TokenUsage | None = None


def _guess_mime(filename: str, content_type: str | None) -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in SUPPORTED_IMAGE_TYPES:
        return "image/jpeg" if ct == "image/jpg" else ct
    lower = (filename or "").lower()
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".gif"):
        return "image/gif"
    return ""


def _record_usage(
    db: Session,
    api_key_id: int,
    input_tokens: int,
    output_tokens: int,
) -> None:
    today = date.today()
    row = db.query(ApiKeyUsage).filter(
        ApiKeyUsage.api_key_id == api_key_id,
        ApiKeyUsage.date == today,
    ).first()
    if row:
        row.request_count += 1
        row.input_tokens += input_tokens
        row.output_tokens += output_tokens
    else:
        row = ApiKeyUsage(
            api_key_id=api_key_id,
            date=today,
            request_count=1,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        db.add(row)
    db.commit()


@router.post(
    "/transcribe",
    response_model=VisionTranscribeResponse,
    summary="圖片文字轉錄",
    description=(
        "透過 API Key 上傳圖片（PNG / JPEG / WebP / GIF），以 Vision LLM 轉錄為文字。\n\n"
        "預設輸出 Markdown（含表格）；可選 `format=plain` 取得純文字。\n\n"
        "需使用支援 Vision 的模型（留空時使用租戶 LLM 預設模型）。\n\n"
        "Rate limit：每個 API Key 每小時最多 100 次請求。"
    ),
    response_description="轉錄文字、格式、模型與 token 用量",
)
@limiter.limit("100/hour")
async def public_vision_transcribe(
    request: Request,
    file: UploadFile,
    format: Annotated[str, Form()] = "markdown",
    hint: Annotated[str, Form()] = "",
    model: Annotated[str, Form()] = "",
    db: Annotated[Session, Depends(get_db)] = ...,
    api_key: Annotated[ApiKey, Depends(get_api_key)] = ...,
):
    tenant_id = api_key.tenant_id
    output_format: Literal["markdown", "plain"] = "plain" if format.strip().lower() == "plain" else "markdown"

    filename = file.filename or "image.png"
    content_type = (file.content_type or "").lower()
    if "pdf" in content_type or filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="僅支援圖片格式（PNG / JPEG / WebP / GIF）；PDF 請使用 Doc Refiner 管線",
        )

    mime = _guess_mime(filename, file.content_type)
    if not mime:
        raise HTTPException(
            status_code=400,
            detail="不支援的檔案格式，請上傳 PNG、JPEG、WebP 或 GIF",
        )

    use_model = resolve_tenant_model(model, db, tenant_id)
    if not use_model:
        raise HTTPException(
            status_code=503,
            detail="請指定 model 參數，或在 AI 設定中設定 LLM Provider（需支援 Vision）",
        )

    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="圖片檔案為空")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"圖片檔案過大（上限 {MAX_IMAGE_BYTES // 1024 // 1024} MB）",
        )

    page_hint = hint.strip()
    logger.info(
        "public vision/transcribe: tenant=%s api_key_id=%d size=%d format=%s model=%s",
        tenant_id,
        api_key.id,
        len(image_bytes),
        output_format,
        use_model,
    )

    try:
        text, usage = await recognize_text_from_image(
            image_bytes,
            mime_type=mime,
            model=model,
            db=db,
            tenant_id=tenant_id,
            page_hint=page_hint,
            output_format=output_format,
        )
    except LLMProviderNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LLMCallError as exc:
        logger.error("public vision/transcribe failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    pt = ct = tt = 0
    if usage:
        pt = usage.get("prompt_tokens", 0) or 0
        ct = usage.get("completion_tokens", 0) or 0
        tt = usage.get("total_tokens", 0) or 0
        _record_usage(db, api_key_id=api_key.id, input_tokens=pt, output_tokens=ct)

    return VisionTranscribeResponse(
        text=text,
        format=output_format,
        model=use_model,
        usage=TokenUsage(prompt_tokens=pt, completion_tokens=ct, total_tokens=tt) if usage else None,
    )
