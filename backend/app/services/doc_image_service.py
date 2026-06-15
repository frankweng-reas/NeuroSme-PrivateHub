"""圖片/PDF → 選擇性萃取 → 結構化 Markdown 服務"""
import base64
import io
import logging
from pathlib import Path
from typing import Any

import litellm
import pdfplumber
from sqlalchemy.orm import Session

from app.services.document_structuring.llm_resolve import resolve_tenant_model
from app.services.llm_caller import LLMCallError, LLMProviderNotConfigured, build_llm_kwargs

logger = logging.getLogger(__name__)

_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
_PROMPT_FILE = "system_prompt_doc_image_refiner.md"

PDF_OCR_RENDER_DPI = 150
IMAGE_MIME_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"}
PDF_MIME_TYPES = {"application/pdf", "application/octet-stream"}


def _load_system_prompt() -> str:
    path = _CONFIG_DIR / _PROMPT_FILE
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        logger.warning("doc_image system prompt 載入失敗: %s", exc)
        return "請從原始文字中，依照用戶提供的主題清單，萃取相關內容並以 Markdown 格式輸出。"


def _usage_dict(resp: Any) -> dict[str, int] | None:
    if not hasattr(resp, "usage") or resp.usage is None:
        return None
    u = resp.usage
    return {
        "prompt_tokens": getattr(u, "prompt_tokens", 0) or 0,
        "completion_tokens": getattr(u, "completion_tokens", 0) or 0,
        "total_tokens": getattr(u, "total_tokens", 0) or 0,
    }


def _render_page_jpeg(page: Any, resolution: int = PDF_OCR_RENDER_DPI, quality: int = 85) -> bytes:
    img = page.to_image(resolution=resolution)
    pil_img = img.original.convert("RGB")
    buf = io.BytesIO()
    pil_img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def _is_image_content_type(content_type: str) -> bool:
    ct = content_type.lower().split(";")[0].strip()
    return ct in IMAGE_MIME_TYPES or ct.startswith("image/")


def _is_pdf_content_type(content_type: str, filename: str = "") -> bool:
    ct = content_type.lower().split(";")[0].strip()
    if ct == "application/pdf":
        return True
    if ct == "application/octet-stream" and (filename or "").lower().endswith(".pdf"):
        return True
    return False


async def _ocr_image_bytes(
    image_bytes: bytes,
    mime_type: str,
    model: str,
    db: Session,
    tenant_id: str,
    page_hint: str = "",
) -> tuple[str, dict[str, int] | None]:
    """Vision LLM 轉錄圖片文字。回傳 (text, usage)。"""
    from app.services.image_text_service import recognize_text_from_image
    return await recognize_text_from_image(
        image_bytes,
        mime_type=mime_type,
        model=model,
        db=db,
        tenant_id=tenant_id,
        page_hint=page_hint,
    )


async def _ocr_pdf(
    pdf_bytes: bytes,
    model: str,
    db: Session,
    tenant_id: str,
) -> tuple[str, dict[str, int] | None]:
    """PDF 每頁整頁渲染 → Vision OCR，回傳合併文字。"""
    parts: list[str] = []
    total_usage: dict[str, int] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page_count = len(pdf.pages)
        for i, page in enumerate(pdf.pages):
            page_num = i + 1
            try:
                jpeg_bytes = _render_page_jpeg(page)
                text, usage = await _ocr_image_bytes(
                    jpeg_bytes,
                    mime_type="image/jpeg",
                    model=model,
                    db=db,
                    tenant_id=tenant_id,
                    page_hint=f"此為文件第 {page_num}/{page_count} 頁。",
                )
                if text.strip():
                    parts.append(f"[第 {page_num} 頁]\n{text.strip()}")
                if usage:
                    for k in total_usage:
                        total_usage[k] += usage.get(k, 0)
            except Exception as exc:
                logger.warning("第 %d 頁 OCR 失敗: %s", page_num, exc)

    return "\n\n".join(parts), total_usage if total_usage["total_tokens"] > 0 else None


def _build_structuring_prompt(raw_text: str, extraction_topics: list[dict]) -> str:
    """根據萃取主題建立 LLM user prompt。"""
    topics_desc = "\n".join(
        f"- **{t['name']}**：{t['hint']}" if t.get("hint") else f"- **{t['name']}**"
        for t in extraction_topics
    )
    return (
        f"## 萃取主題清單\n{topics_desc}\n\n"
        f"## 原始文字\n{raw_text}"
    )


async def process_image_to_markdown(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    *,
    extraction_topics: list[dict],
    model: str,
    db: Session,
    tenant_id: str,
) -> dict[str, Any]:
    """
    圖片/PDF → 選擇性萃取 → 結構化 Markdown。

    回傳：{raw_text, markdown, usage}
    """
    if not extraction_topics:
        raise ValueError("請至少定義一個萃取主題")

    use_model = resolve_tenant_model(model, db, tenant_id)
    if not use_model:
        raise ValueError("請指定模型，或在 AI 設定中設定 LLM Provider")

    ocr_usage: dict[str, int] | None = None

    # Step 1: OCR
    if _is_image_content_type(content_type):
        mime = content_type.lower().split(";")[0].strip()
        raw_text, ocr_usage = await _ocr_image_bytes(
            file_bytes, mime_type=mime, model=use_model, db=db, tenant_id=tenant_id,
        )
    elif _is_pdf_content_type(content_type, filename):
        raw_text, ocr_usage = await _ocr_pdf(
            file_bytes, model=use_model, db=db, tenant_id=tenant_id,
        )
    else:
        raise ValueError(f"不支援的檔案格式：{content_type}")

    if not raw_text.strip():
        raise ValueError("無法從檔案中辨識出文字內容")

    # Step 2: 選擇性結構化
    system_prompt = _load_system_prompt()
    user_prompt = _build_structuring_prompt(raw_text, extraction_topics)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    try:
        kwargs = build_llm_kwargs(
            model=use_model,
            messages=messages,
            db=db,
            tenant_id=tenant_id,
            stream=False,
            temperature=0,
            timeout=180,
        )
    except LLMProviderNotConfigured as exc:
        raise ValueError(str(exc)) from exc

    logger.info("doc_image: structuring model=%s topics=%d raw_chars=%d",
                use_model, len(extraction_topics), len(raw_text))

    try:
        resp = await litellm.acompletion(**kwargs)
    except Exception as exc:
        raise LLMCallError(f"結構化 LLM 呼叫失敗：{exc}", cause=exc) from exc

    markdown = (resp.choices[0].message.content or "").strip()
    struct_usage = _usage_dict(resp)

    # 合併 usage
    combined_usage: dict[str, int] | None = None
    if ocr_usage or struct_usage:
        combined_usage = {
            "prompt_tokens": (ocr_usage or {}).get("prompt_tokens", 0) + (struct_usage or {}).get("prompt_tokens", 0),
            "completion_tokens": (ocr_usage or {}).get("completion_tokens", 0) + (struct_usage or {}).get("completion_tokens", 0),
            "total_tokens": (ocr_usage or {}).get("total_tokens", 0) + (struct_usage or {}).get("total_tokens", 0),
        }

    return {
        "raw_text": raw_text,
        "markdown": markdown,
        "usage": combined_usage,
    }
