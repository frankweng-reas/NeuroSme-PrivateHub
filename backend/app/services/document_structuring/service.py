import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from sqlalchemy.orm import Session

from app.services.chat_service import _load_system_prompt_from_file
from app.services.document_service import LLMContext
from app.services.document_service import extract as doc_extract
from app.services.document_structuring.enrich import enrich
from app.services.document_structuring.llm_resolve import resolve_tenant_model
from app.services.document_structuring.strategies import (
    build_llm_user_prompt,
    split_text,
    strip_md_fence,
)
from app.services.document_structuring.types import ExtractResult
from app.services.llm_caller import LLMCallError, LLMProviderNotConfigured, call_llm

logger = logging.getLogger(__name__)


def _title_from_filename(filename: str) -> str:
    name = filename or "文件"
    return name.rsplit(".", 1)[0] if "." in name else name


class DocumentStructuringService:
    """PDF → structured Markdown pipeline（extract → LLM structure → enrich）。"""

    async def extract_async(
        self,
        file_bytes: bytes,
        filename: str,
        *,
        mode: str = "image",
        model: str,
        db: Session,
        tenant_id: str,
        on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> ExtractResult:
        llm_ctx = LLMContext(model=model, db=db, tenant_id=tenant_id)
        result = await doc_extract(file_bytes, mode=mode, llm_ctx=llm_ctx, on_progress=on_progress)
        return ExtractResult(
            text=result.text,
            page_count=result.page_count,
            source_format="pdf",
            filename=filename,
            title=_title_from_filename(filename),
            ocr_pages=result.ocr_pages,
        )

    def enrich_markdown(
        self,
        body: str,
        *,
        title: str,
        original_file: str,
        source: str = "doc-refiner-md",
    ) -> str:
        return enrich(body, title=title, original_file=original_file, source=source)

    async def structure_stream(
        self,
        extracted: ExtractResult,
        *,
        model: str,
        db: Session,
        tenant_id: str,
        source: str = "doc-refiner-md",
        source_url: str | None = None,
    ) -> AsyncIterator[dict]:
        """SSE 事件：meta | md_chunk | done | error。"""
        raw_text = extracted.text.strip()
        if not raw_text:
            yield {"type": "error", "detail": "無法從檔案萃取文字內容"}
            return

        use_model = resolve_tenant_model(model, db, tenant_id)
        if not use_model:
            yield {"type": "error", "detail": "請指定 model 參數，或在 AI 設定中設定 LLM Provider"}
            return

        system_prompt = _load_system_prompt_from_file("doc_refiner_md") or ""
        chunks = split_text(raw_text)
        chunk_total = len(chunks)
        char_count = len(raw_text)
        front_matter = enrich(
            "",
            title=extracted.title,
            original_file=extracted.filename,
            ocr_pages=extracted.ocr_pages or None,
            source=source,
            source_url=source_url,
        ).rstrip()

        yield {
            "type": "meta",
            "page_count": extracted.page_count,
            "char_count": char_count,
            "chunk_total": chunk_total,
            "ocr_pages": extracted.ocr_pages,
        }

        total_pt = total_ct = total_tt = 0

        try:
            for idx, chunk_text in enumerate(chunks, 1):
                messages = [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": build_llm_user_prompt(
                            title=extracted.title,
                            chunk_text=chunk_text,
                            chunk_index=idx,
                            chunk_total=chunk_total,
                        ),
                    },
                ]

                try:
                    answer, llm_usage, _ = await call_llm(
                        model=use_model,
                        messages=messages,
                        db=db,
                        tenant_id=tenant_id,
                        temperature=0.2,
                    )
                except (LLMProviderNotConfigured, LLMCallError) as exc:
                    yield {"type": "error", "detail": str(exc)}
                    return
                except Exception as exc:
                    logger.error("structure_stream call_llm chunk %d: %s", idx, exc)
                    yield {"type": "error", "detail": f"AI 呼叫失敗：{exc}"}
                    return

                if llm_usage:
                    total_pt += getattr(llm_usage, "prompt_tokens", 0) or 0
                    total_ct += getattr(llm_usage, "completion_tokens", 0) or 0
                    total_tt += getattr(llm_usage, "total_tokens", 0) or 0

                md_body = strip_md_fence(answer)
                if idx == 1:
                    md_content = front_matter + "\n\n" + md_body if md_body else front_matter
                else:
                    md_content = md_body

                logger.info("structure_stream chunk %d/%d done (%d chars)", idx, chunk_total, len(md_content))
                yield {
                    "type": "md_chunk",
                    "chunk": idx,
                    "chunk_total": chunk_total,
                    "content": md_content,
                }

            yield {
                "type": "done",
                "model": use_model,
                "usage": {
                    "prompt_tokens": total_pt,
                    "completion_tokens": total_ct,
                    "total_tokens": total_tt,
                },
            }
        except Exception as exc:
            logger.error("structure_stream 非預期例外: %s", exc)
            yield {"type": "error", "detail": f"處理失敗：{exc}"}

    async def structure_full(
        self,
        extracted: ExtractResult,
        *,
        model: str,
        db: Session,
        tenant_id: str,
    ) -> str:
        """非串流版本：收集 structure_stream 的所有 md_chunk 後回傳完整 markdown。
        供 KB Manager 直接上傳 structured_md 使用。
        """
        parts: list[str] = []
        async for event in self.structure_stream(extracted, model=model, db=db, tenant_id=tenant_id):
            if event["type"] == "md_chunk":
                parts.append(event["content"])
            elif event["type"] == "error":
                raise ValueError(event["detail"])
        return "\n\n".join(parts)
