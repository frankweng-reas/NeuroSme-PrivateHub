"""圖片 → 純文字（Vision LLM 轉錄）。供 PDF OCR 補強、未來 OCR Agent 共用。"""
import base64
import logging
import re
from pathlib import Path
from typing import Any, Literal

import litellm
from sqlalchemy.orm import Session

from app.services.document_structuring.llm_resolve import resolve_tenant_model
from app.services.llm_caller import LLMCallError, LLMProviderNotConfigured, build_llm_kwargs

logger = logging.getLogger(__name__)

_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
_PROMPT_FILE = "system_prompt_image_text.md"

_FENCE_RE = re.compile(r"^```(?:\w+)?\s*\n?|\n?```\s*$", re.MULTILINE)


def _load_system_prompt() -> str:
    path = _CONFIG_DIR / _PROMPT_FILE
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        logger.warning("image_text system prompt 載入失敗: %s", exc)
        return "請將圖片中的所有文字轉錄為純文字，保留原文，不要翻譯。"


def _strip_fences(text: str) -> str:
    return _FENCE_RE.sub("", text.strip()).strip()


def _usage_dict(resp: Any) -> dict[str, int] | None:
    if not hasattr(resp, "usage") or resp.usage is None:
        return None
    u = resp.usage
    return {
        "prompt_tokens": getattr(u, "prompt_tokens", 0) or 0,
        "completion_tokens": getattr(u, "completion_tokens", 0) or 0,
        "total_tokens": getattr(u, "total_tokens", 0) or 0,
    }


async def recognize_text_from_image(
    image_bytes: bytes,
    *,
    mime_type: str = "image/png",
    model: str,
    db: Session,
    tenant_id: str,
    page_hint: str = "",
    output_format: Literal["markdown", "plain"] = "markdown",
) -> tuple[str, dict[str, int] | None]:
    """Vision LLM 轉錄圖片文字。回傳 (text, usage)。"""
    if not image_bytes:
        return "", None

    use_model = resolve_tenant_model(model, db, tenant_id)
    if not use_model:
        raise ValueError("請指定 model 參數，或在 AI 設定中設定 LLM Provider")

    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    mime = mime_type if mime_type.startswith("image/") else "image/png"
    user_text = "請轉錄此圖片中的所有文字。"
    if output_format == "plain":
        user_text += " 以純文字輸出，不要使用 Markdown 表格語法（| --- |）或標題語法（#）。"
    if page_hint:
        user_text = f"{page_hint}\n\n{user_text}"

    messages = [
        {"role": "system", "content": _load_system_prompt()},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                {"type": "text", "text": user_text},
            ],
        },
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

    try:
        resp = await litellm.acompletion(**kwargs)
    except Exception as exc:
        raise LLMCallError(f"圖片文字轉錄失敗：{exc}", cause=exc) from exc

    raw = (resp.choices[0].message.content or "").strip()
    text = _strip_fences(raw)
    logger.info("image_text: model=%s chars=%d", use_model, len(text))
    return text, _usage_dict(resp)
