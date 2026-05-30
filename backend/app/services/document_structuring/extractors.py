import io
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import fitz
import pdfplumber
from sqlalchemy.orm import Session

from app.services.document_structuring.types import ExtractResult, SourceFormat
from app.services.image_text_service import recognize_text_from_image
from app.services.km_service import extract_text as km_extract_text

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = frozenset({".pdf", ".docx", ".txt"})
# 結構化 MD 管線（/to-markdown）僅接受 PDF
STRUCTURED_MD_EXTENSIONS = frozenset({".pdf"})

# 單頁文字低於此門檻 → 幾乎全是圖/掃描，走完整 OCR pipeline（內嵌圖＋整頁渲染）
LOW_TEXT_CHAR_THRESHOLD = 50
# 單頁文字低於此門檻 → 有文字但仍有空間放含文字的圖，只 OCR 內嵌圖（不整頁渲染）
# 高於此門檻 → 文字豐富，圖片視為裝飾，不做圖片 OCR
RICH_TEXT_CHAR_THRESHOLD = 500
PDF_OCR_RENDER_DPI = 150
# 內嵌圖 OCR：以頁面座標（pt）與佔比過濾小 icon / logo
EMBEDDED_IMAGE_MIN_SIDE_PT = 72
EMBEDDED_IMAGE_MIN_AREA_RATIO = 0.035
EMBEDDED_IMAGE_MIN_PIXEL_SIDE = 48

ExtractProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


def _title_from_filename(filename: str) -> str:
    name = filename or "文件"
    if "." in name:
        return name.rsplit(".", 1)[0]
    return name


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


def _render_page_png(page: Any, resolution: int = PDF_OCR_RENDER_DPI) -> bytes:
    """將 PDF 頁渲染為 PNG bytes（需 pypdfium2）。"""
    img = page.to_image(resolution=resolution)
    buf = io.BytesIO()
    img.original.save(buf, format="PNG")
    return buf.getvalue()


def _mime_from_image_ext(ext: str) -> str:
    normalized = (ext or "png").lower().lstrip(".")
    if normalized in {"jpg", "jpeg"}:
        return "image/jpeg"
    if normalized == "webp":
        return "image/webp"
    if normalized == "gif":
        return "image/gif"
    return "image/png"


def _embedded_image_worth_ocr(display_area: float, display_max_side: float, page_area: float) -> bool:
    """依圖在頁面上的顯示尺寸，判斷是否值得做 Vision OCR。"""
    if page_area <= 0:
        return False
    if display_max_side < EMBEDDED_IMAGE_MIN_SIDE_PT:
        return False
    return (display_area / page_area) >= EMBEDDED_IMAGE_MIN_AREA_RATIO


@dataclass
class _EmbeddedImageCandidate:
    xref: int
    display_area: float
    image_bytes: bytes
    mime: str
    pixel_w: int
    pixel_h: int


def _collect_embedded_image_candidates(
    doc: fitz.Document,
    page: fitz.Page,
    page_num: int,
) -> list[_EmbeddedImageCandidate]:
    """收集頁內值得 OCR 的內嵌圖，依顯示面積由大到小排序。"""
    candidates: list[_EmbeddedImageCandidate] = []
    page_area = page.rect.width * page.rect.height
    seen_xrefs: set[int] = set()

    for img in page.get_images(full=True):
        xref = int(img[0])
        if xref in seen_xrefs:
            continue
        seen_xrefs.add(xref)

        try:
            rects = page.get_image_rects(xref)
        except Exception as exc:
            logger.debug("PDF 第 %d 頁 xref %d 無法取得 rect: %s", page_num, xref, exc)
            continue
        if not rects:
            continue

        display_area = max(r.width * r.height for r in rects)
        display_max_side = max(max(r.width, r.height) for r in rects)
        if not _embedded_image_worth_ocr(display_area, display_max_side, page_area):
            continue

        try:
            info = doc.extract_image(xref)
        except Exception as exc:
            logger.warning("PDF 第 %d 頁 xref %d 圖片萃取失敗: %s", page_num, xref, exc)
            continue

        image_bytes = info.get("image") or b""
        if not image_bytes:
            continue

        pixel_w = int(info.get("width") or 0)
        pixel_h = int(info.get("height") or 0)
        if max(pixel_w, pixel_h) < EMBEDDED_IMAGE_MIN_PIXEL_SIDE:
            continue

        candidates.append(
            _EmbeddedImageCandidate(
                xref=xref,
                display_area=display_area,
                image_bytes=image_bytes,
                mime=_mime_from_image_ext(str(info.get("ext") or "png")),
                pixel_w=pixel_w,
                pixel_h=pixel_h,
            )
        )

    candidates.sort(key=lambda c: c.display_area, reverse=True)
    return candidates


async def _ocr_candidates(
    candidates: list[_EmbeddedImageCandidate],
    page_num: int,
    *,
    model: str,
    db: Session,
    tenant_id: str,
    on_progress: ExtractProgressCallback | None = None,
    page_count: int = 0,
) -> list[str]:
    """對已收集的圖片候選清單執行 OCR，回傳含標題的區塊列表。"""
    blocks: list[str] = []
    for img_index, candidate in enumerate(candidates, 1):
        if on_progress:
            await on_progress(
                {
                    "type": "extract_progress",
                    "page": page_num,
                    "page_count": page_count,
                    "stage": "embedded_ocr",
                    "detail": f"第 {page_num} 頁內嵌圖 {img_index}/{len(candidates)}",
                }
            )
        try:
            ocr_text, _ = await recognize_text_from_image(
                candidate.image_bytes,
                mime_type=candidate.mime,
                model=model,
                db=db,
                tenant_id=tenant_id,
                page_hint=f"此為 PDF 第 {page_num} 頁的第 {img_index} 張內嵌圖片。",
            )
        except Exception as exc:
            logger.warning("PDF 第 %d 頁內嵌圖 %d OCR 失敗: %s", page_num, img_index, exc)
            continue
        if ocr_text.strip() and not _is_bogus_ocr_text(ocr_text):
            blocks.append(f"[圖片 OCR · 第 {page_num} 頁 · 圖 {img_index}]\n{ocr_text.strip()}")
    return blocks


def extract_pdf(file_bytes: bytes) -> tuple[str, int]:
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


async def extract_pdf_with_ocr(
    file_bytes: bytes,
    *,
    model: str,
    db: Session,
    tenant_id: str,
    low_text_threshold: int = LOW_TEXT_CHAR_THRESHOLD,
    rich_text_threshold: int = RICH_TEXT_CHAR_THRESHOLD,
    on_progress: ExtractProgressCallback | None = None,
) -> tuple[str, int, list[int]]:
    """PDF 萃取 + 智慧 OCR 策略（以圖片偵測為主信號，文字量為輔）：

    先偵測頁面是否有值得 OCR 的大圖：
      無大圖 + 文字 >= low_threshold → 純文字頁，直接用文字層
      無大圖 + 文字 <  low_threshold → 可能是無法萃取的掃描，整頁渲染 OCR
      有大圖 + 文字 >= rich_threshold → 文字豐富，圖是裝飾/重複渲染，不 OCR
      有大圖 + 文字 <  rich_threshold → 圖可能含重要文字，OCR 內嵌大圖
        └ OCR 無結果且文字極少 → 整頁渲染 OCR 備援

    回傳 (text, page_count, ocr_pages)。"""
    ocr_pages: list[int] = []
    parts: list[str] = []

    fitz_doc = fitz.open(stream=file_bytes, filetype="pdf")
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            page_count = len(pdf.pages)
            page_bodies = _page_bodies_from_pdf(pdf)

            if on_progress:
                await on_progress(
                    {
                        "type": "extract_progress",
                        "page": 0,
                        "page_count": page_count,
                        "stage": "start",
                        "detail": f"開始解析 PDF（共 {page_count} 頁）",
                    }
                )

            for i, page in enumerate(pdf.pages):
                page_num = i + 1
                fitz_page = fitz_doc[i]
                page_body = page_bodies[i]
                page_char_count = _meaningful_char_count(page_body)

                full_page_ocr_text = ""
                embedded_blocks: list[str] = []

                # 主信號：偵測頁面是否有值得 OCR 的大圖
                candidates = _collect_embedded_image_candidates(fitz_doc, fitz_page, page_num)
                has_large_images = bool(candidates)

                # 判斷最大圖是否為全頁渲染圖（html2pdf / Word 轉 PDF 常見）
                page_area = fitz_page.rect.width * fitz_page.rect.height
                max_img_ratio = (
                    max(c.display_area for c in candidates) / page_area
                    if candidates and page_area > 0
                    else 0.0
                )
                is_full_page_render = max_img_ratio > 0.75
                logger.info(
                    "PDF 第 %d 頁診斷: chars=%d, candidates=%d, max_img_ratio=%.2f, is_full_page_render=%s",
                    page_num, page_char_count, len(candidates), max_img_ratio, is_full_page_render,
                )

                if not has_large_images:
                    if page_char_count < low_text_threshold:
                        # 無可萃取大圖 + 文字極少 → 可能是純掃描頁，整頁渲染 OCR
                        if on_progress:
                            await on_progress(
                                {
                                    "type": "extract_progress",
                                    "page": page_num,
                                    "page_count": page_count,
                                    "stage": "full_page_ocr",
                                    "detail": f"第 {page_num} 頁整頁 OCR",
                                }
                            )
                        try:
                            png_bytes = _render_page_png(page)
                            full_page_ocr_text, _ = await recognize_text_from_image(
                                png_bytes,
                                mime_type="image/png",
                                model=model,
                                db=db,
                                tenant_id=tenant_id,
                                page_hint=f"此為 PDF 第 {page_num} 頁。",
                            )
                        except Exception as exc:
                            logger.warning("PDF 第 %d 頁整頁 OCR 失敗: %s", page_num, exc)
                            full_page_ocr_text = ""
                        if _is_bogus_ocr_text(full_page_ocr_text):
                            full_page_ocr_text = ""
                    # 無大圖 + 文字充足 → 純文字頁，直接用文字層，不做任何 OCR

                elif is_full_page_render and page_char_count >= low_text_threshold:
                    # 全頁渲染圖（佔 75%+ 頁面）且文字層有內容
                    # → 圖是文字層的視覺重複（html2pdf / Word 轉 PDF），不 OCR
                    logger.debug(
                        "PDF 第 %d 頁：全頁渲染圖（%.0f%%）+ 文字層 %d 字，略過 OCR",
                        page_num, max_img_ratio * 100, page_char_count,
                    )

                elif page_char_count >= rich_text_threshold:
                    # 文字豐富（≥500字）→ 圖是裝飾，不 OCR
                    pass

                else:
                    # 有大圖（非全頁渲染或文字極少）→ 圖可能含重要文字（截圖、圖表等）
                    embedded_blocks = await _ocr_candidates(
                        candidates,
                        page_num,
                        model=model,
                        db=db,
                        tenant_id=tenant_id,
                        on_progress=on_progress,
                        page_count=page_count,
                    )
                    if not embedded_blocks and page_char_count < low_text_threshold:
                        # OCR 無結果且文字極少 → 整頁渲染備援
                        if on_progress:
                            await on_progress(
                                {
                                    "type": "extract_progress",
                                    "page": page_num,
                                    "page_count": page_count,
                                    "stage": "full_page_ocr",
                                    "detail": f"第 {page_num} 頁整頁 OCR（備援）",
                                }
                            )
                        try:
                            png_bytes = _render_page_png(page)
                            full_page_ocr_text, _ = await recognize_text_from_image(
                                png_bytes,
                                mime_type="image/png",
                                model=model,
                                db=db,
                                tenant_id=tenant_id,
                                page_hint=f"此為 PDF 第 {page_num} 頁。",
                            )
                        except Exception as exc:
                            logger.warning("PDF 第 %d 頁整頁 OCR 備援失敗: %s", page_num, exc)
                            full_page_ocr_text = ""
                        if _is_bogus_ocr_text(full_page_ocr_text):
                            full_page_ocr_text = ""

                page_used_ocr = bool(full_page_ocr_text.strip() or embedded_blocks)
                if page_used_ocr and page_num not in ocr_pages:
                    ocr_pages.append(page_num)

                sections: list[str] = []
                if page_body.strip():
                    sections.append(page_body.strip())
                if full_page_ocr_text.strip():
                    if page_body.strip():
                        sections.append("[OCR 補充]\n" + full_page_ocr_text.strip())
                    else:
                        sections.append(full_page_ocr_text.strip())
                sections.extend(embedded_blocks)

                combined = "\n\n".join(sections)
                if combined.strip():
                    page_label = f"[第 {page_num} 頁 · OCR]" if page_used_ocr else f"[第 {page_num} 頁]"
                    parts.append(f"{page_label}\n{combined}")
    finally:
        fitz_doc.close()

    text = "\n\n".join(parts)
    if not text.strip():
        fallback = _extract_text_pypdf(file_bytes)
        if fallback.strip():
            logger.info("PDF OCR 後仍無內容，pypdf 備援（%d 字）", len(fallback))
            text = fallback
    return text, page_count, ocr_pages


def extract_docx(file_bytes: bytes, filename: str) -> tuple[str, int]:
    """DOCX 萃取 plain text（不解析 Word 標題樣式）。"""
    text = km_extract_text(
        file_bytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename,
    )
    page_count = max(1, len(text) // 2000)
    return text, page_count


def extract_txt(file_bytes: bytes) -> tuple[str, int]:
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        text = file_bytes.decode("utf-8", errors="replace")
    page_count = max(1, len(text) // 2000)
    return text, page_count


def extract(file_bytes: bytes, filename: str) -> ExtractResult:
    """依副檔名萃取文字（PDF 不含 OCR）。回傳 ExtractResult。"""
    lower = (filename or "").lower()
    title = _title_from_filename(filename)

    if lower.endswith(".txt"):
        text, page_count = extract_txt(file_bytes)
        fmt: SourceFormat = "txt"
    elif lower.endswith(".docx"):
        text, page_count = extract_docx(file_bytes, filename)
        fmt = "docx"
    elif lower.endswith(".pdf"):
        text, page_count = extract_pdf(file_bytes)
        fmt = "pdf"
    else:
        raise ValueError(f"不支援的檔案格式：{filename}")

    return ExtractResult(
        text=text,
        page_count=page_count,
        source_format=fmt,
        filename=filename,
        title=title,
        ocr_pages=[],
    )


async def extract_async(
    file_bytes: bytes,
    filename: str,
    *,
    model: str,
    db: Session,
    tenant_id: str,
    enable_pdf_ocr: bool = True,
    on_progress: ExtractProgressCallback | None = None,
) -> ExtractResult:
    """非同步萃取；PDF 可啟用低文字頁 OCR 補強。"""
    lower = (filename or "").lower()
    title = _title_from_filename(filename)
    ocr_pages: list[int] = []

    if lower.endswith(".txt"):
        text, page_count = extract_txt(file_bytes)
        fmt: SourceFormat = "txt"
    elif lower.endswith(".docx"):
        text, page_count = extract_docx(file_bytes, filename)
        fmt = "docx"
    elif lower.endswith(".pdf"):
        fmt = "pdf"
        if enable_pdf_ocr:
            text, page_count, ocr_pages = await extract_pdf_with_ocr(
                file_bytes,
                model=model,
                db=db,
                tenant_id=tenant_id,
                on_progress=on_progress,
            )
        else:
            text, page_count = extract_pdf(file_bytes)
    else:
        raise ValueError(f"不支援的檔案格式：{filename}")

    return ExtractResult(
        text=text,
        page_count=page_count,
        source_format=fmt,
        filename=filename,
        title=title,
        ocr_pages=ocr_pages,
    )


def is_supported_filename(filename: str) -> bool:
    """結構化 MD 管線支援的副檔名（目前僅 PDF）。"""
    lower = (filename or "").lower()
    return any(lower.endswith(ext) for ext in STRUCTURED_MD_EXTENSIONS)
