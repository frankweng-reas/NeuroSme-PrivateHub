"""統一的 PDF 萃取服務（PDF only 策略）。

所有需要讀取 PDF 內容的模組應呼叫此服務，不應各自實作萃取邏輯。
其他格式（DOCX、TXT 等）未來以「先轉 PDF」策略統一，目前不在此服務範圍內。

公開 API：
    extract(pdf_bytes, *, mode="image", llm_ctx=None, on_progress=None) -> PdfExtractResult
        統一入口。傳入 PDF bytes，傳回文字。
        mode="text" : 僅萃取文字層，速度快，適合純文字 PDF
        mode="image": 每頁整頁渲染 → Vision OCR，適合掃描型／向量圖形型 PDF
        llm_ctx 未提供時強制使用 text mode（無法呼叫 Vision OCR）。

    LLMContext   — 包裝 model / db / tenant_id 的 context 物件
    PdfExtractResult — 回傳結果 dataclass
    ExtractProgressCallback  — on_progress 回呼的型別別名
"""
import io
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import pdfplumber
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

PDF_OCR_RENDER_DPI = 150

ExtractProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass
class LLMContext:
    """呼叫 Vision OCR 所需的 LLM 環境資訊。"""
    model: str
    db: Session
    tenant_id: str


@dataclass
class PdfExtractResult:
    """`extract()` 的回傳結果。"""
    text: str
    page_count: int
    ocr_pages: list[int]


def _table_to_markdown(table: list[list]) -> str:
    rows = [[str(cell or "").strip() for cell in row] for row in table if any(cell for cell in row)]
    if not rows:
        return ""
    header = rows[0]
    body = rows[1:]
    sep = ["---"] * len(header)
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(sep) + " |",
    ] + ["| " + " | ".join(row) + " |" for row in body]
    return "\n".join(lines)


def _collapse_spaced_text(text: str) -> str:
    if not text:
        return text
    non_newline = text.replace("\n", "")
    char_count = len(non_newline.replace(" ", ""))
    space_count = non_newline.count(" ")
    if char_count > 0 and space_count / max(char_count, 1) > 0.6:
        text = re.sub(r"(?<=\S) (?=\S)", "", text)
        text = re.sub(r"  +", " ", text)
    return text


def _extract_text_pypdf(pdf_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(pdf_bytes))
        parts: list[str] = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text.strip():
                parts.append(_collapse_spaced_text(text.strip()))
        return "\n\n".join(parts)
    except Exception as exc:
        logger.warning("pypdf 備援萃取失敗: %s", exc)
        return ""


def _page_text_segments(page: Any) -> list[str]:
    """從 pdfplumber page 萃取文字層 + 表格 Markdown。"""
    segments: list[str] = []

    tables = page.find_tables()
    table_bboxes = [t.bbox for t in tables]
    for t in tables:
        md = _table_to_markdown(t.extract())
        if md:
            segments.append(md)

    if table_bboxes:
        words = page.extract_words()
        non_table_words = []
        for w in words:
            wx0, wy0, wx1, wy1 = w["x0"], w["top"], w["x1"], w["bottom"]
            in_table = any(
                wx0 >= bx0 and wy0 >= by0 and wx1 <= bx1 and wy1 <= by1
                for bx0, by0, bx1, by1 in table_bboxes
            )
            if not in_table:
                non_table_words.append(w["text"])
        plain = " ".join(non_table_words).strip()
    else:
        plain = (page.extract_text() or "").strip()

    if plain:
        segments.insert(0, plain)
    return segments


def _meaningful_char_count(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


_BOGUS_OCR_PATTERNS = (
    r"尚未提供.*圖片",
    r"請上傳.*圖",
    r"请上传.*图",
    r"没有.*图片",
    r"沒有.*圖片",
    r"未提供.*圖",
    r"无法.*识别.*图",
    r"無法.*識別.*圖",
)


def _is_bogus_ocr_text(text: str) -> bool:
    """過濾 Vision 對空白/無效圖片的拒答或幻覺。"""
    t = (text or "").strip()
    if not t:
        return True
    for pat in _BOGUS_OCR_PATTERNS:
        if re.search(pat, t, flags=re.I):
            return True
    return False


def _page_bodies_from_pdf(pdf: Any) -> list[str]:
    return ["\n\n".join(_page_text_segments(page)) for page in pdf.pages]


def _assemble_pdf_parts(page_bodies: list[str], *, ocr_suffix: str = "") -> str:
    parts: list[str] = []
    for i, body in enumerate(page_bodies):
        if not body.strip():
            continue
        label = f"[第 {i + 1} 頁{ocr_suffix}]"
        parts.append(f"{label}\n{body.strip()}")
    return "\n\n".join(parts)


def _render_page_jpeg(page: Any, resolution: int = PDF_OCR_RENDER_DPI, quality: int = 85) -> bytes:
    """將 PDF 頁渲染為 JPEG bytes（比 PNG 小 5-10x，大幅縮短 Vision OCR 時間）。"""
    img = page.to_image(resolution=resolution)
    pil_img = img.original.convert("RGB")  # JPEG 不支援 RGBA
    buf = io.BytesIO()
    pil_img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()




def _extract_pdf(file_bytes: bytes) -> tuple[str, int]:
    """PDF 萃取（pdfplumber 主、pypdf 備援），不含 OCR。回傳 (text, page_count)。"""
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        page_count = len(pdf.pages)
        parts: list[str] = []
        for i, page in enumerate(pdf.pages):
            segments = _page_text_segments(page)
            if segments:
                parts.append(f"[第 {i + 1} 頁]\n" + "\n\n".join(segments))

    text = "\n\n".join(parts)
    if len(text.strip()) < 50:
        fallback = _extract_text_pypdf(file_bytes)
        if len(fallback) > len(text):
            logger.info("pdfplumber 萃取不足，改用 pypdf 備援（%d 字）", len(fallback))
            text = fallback
    return text, page_count


async def _full_page_ocr_all(
    file_bytes: bytes,
    *,
    model: str,
    db: Session,
    tenant_id: str,
    on_progress: ExtractProgressCallback | None = None,
) -> tuple[str, int, list[int]]:
    """圖片模式：每頁整頁渲染 → Vision OCR。回傳 (text, page_count, ocr_pages)。"""
    from app.services.image_text_service import recognize_text_from_image  # lazy import，避免循環依賴
    ocr_pages: list[int] = []
    parts: list[str] = []

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        page_count = len(pdf.pages)
        if on_progress:
            await on_progress({
                "type": "extract_progress",
                "page": 0,
                "page_count": page_count,
                "stage": "start",
                "detail": f"開始解析 PDF（共 {page_count} 頁）",
            })
        for i, page in enumerate(pdf.pages):
            page_num = i + 1
            if on_progress:
                await on_progress({
                    "type": "extract_progress",
                    "page": page_num,
                    "page_count": page_count,
                    "stage": "full_page_ocr",
                    "detail": f"第 {page_num}/{page_count} 頁 OCR",
                })
            ocr_text = ""
            try:
                jpeg_bytes = _render_page_jpeg(page)
                ocr_text, _ = await recognize_text_from_image(
                    jpeg_bytes,
                    mime_type="image/jpeg",
                    model=model,
                    db=db,
                    tenant_id=tenant_id,
                    page_hint=f"此為 PDF 第 {page_num} 頁。",
                )
            except Exception as exc:
                logger.warning("PDF 第 %d 頁 OCR 失敗: %s", page_num, exc)
            if _is_bogus_ocr_text(ocr_text):
                ocr_text = ""

            if ocr_text.strip():
                ocr_pages.append(page_num)
                parts.append(f"[第 {page_num} 頁 · OCR]\n{ocr_text.strip()}")
            else:
                # OCR 失敗備援：嘗試文字層
                page_body = "\n\n".join(_page_text_segments(page))
                if page_body.strip():
                    parts.append(f"[第 {page_num} 頁]\n{page_body.strip()}")

    text = "\n\n".join(parts)
    if not text.strip():
        fallback = _extract_text_pypdf(file_bytes)
        if fallback.strip():
            logger.info("圖片模式 OCR 後仍無內容，pypdf 備援（%d 字）", len(fallback))
            text = fallback
    return text, page_count, ocr_pages


def extract_txt(file_bytes: bytes) -> tuple[str, int]:
    """純文字檔萃取。回傳 (text, page_count)。"""
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        text = file_bytes.decode("utf-8", errors="replace")
    page_count = max(1, len(text) // 2000)
    return text, page_count


def is_supported_filename(filename: str) -> bool:
    """document_service 支援的副檔名（目前僅 PDF）。"""
    return (filename or "").lower().endswith(".pdf")


async def extract(
    pdf_bytes: bytes,
    *,
    mode: str = "image",
    llm_ctx: LLMContext | None = None,
    on_progress: ExtractProgressCallback | None = None,
) -> PdfExtractResult:
    """統一的 PDF 萃取入口。

    mode="text" : 僅萃取文字層，速度快，適合純文字 PDF
    mode="image": 每頁整頁渲染 → Vision OCR，適合掃描型／向量圖形型 PDF
    llm_ctx 未提供時強制使用 text mode（無法呼叫 Vision OCR）。
    """
    if llm_ctx is None or mode == "text":
        text, page_count = _extract_pdf(pdf_bytes)
        return PdfExtractResult(text=text, page_count=page_count, ocr_pages=[])

    text, page_count, ocr_pages = await _full_page_ocr_all(
        pdf_bytes,
        model=llm_ctx.model,
        db=llm_ctx.db,
        tenant_id=llm_ctx.tenant_id,
        on_progress=on_progress,
    )
    return PdfExtractResult(text=text, page_count=page_count, ocr_pages=ocr_pages)
