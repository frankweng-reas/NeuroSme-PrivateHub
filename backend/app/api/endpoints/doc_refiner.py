"""文件整理 Agent API

POST /doc-refiner/process   - 上傳 PDF，LLM 整理成 Q&A 或摘要，回傳 JSON
POST /doc-refiner/export    - 接收整理後的 JSON，產生 PDF 下載
"""
import asyncio
import io
import json
import logging
import re
from pathlib import Path
from typing import Annotated, Any

import pdfplumber
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.chat_service import _load_system_prompt_from_file
from app.services.llm_caller import LLMCallError, LLMProviderNotConfigured, call_llm

router = APIRouter()
logger = logging.getLogger(__name__)

_FONT_PATH = Path(__file__).resolve().parents[3] / "config" / "fonts" / "NotoSansTC-Regular.ttf"
_MAX_PDF_BYTES = 20 * 1024 * 1024  # 20 MB
_CHUNK_SIZE    = 20_000            # 每段最大字數
_CHUNK_OVERLAP = 300               # 相鄰段落重疊字數（避免語意硬切）


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────

class TokenUsage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ExportItem(BaseModel):
    id: int
    question: str
    answer: str


class ExportRequest(BaseModel):
    title: str
    items: list[dict[str, Any]]


class ImportToKBRequest(BaseModel):
    title: str
    items: list[dict[str, Any]]   # [{question, answer}]
    kb_id: int | None = None      # 現有 KB id（與 new_kb_name 擇一）
    new_kb_name: str | None = None  # 若要同時建立新 KB


class ImportToKBResponse(BaseModel):
    kb_id: int
    kb_name: str
    doc_id: int
    imported_count: int


class ImportMdToKBRequest(BaseModel):
    title: str
    markdown: str              # 完整 MD 內容（含 YAML front matter）
    kb_id: int | None = None   # 現有 KB id（與 new_kb_name 擇一）
    new_kb_name: str | None = None
    doc_type: str = "structured_md"  # 預設 structured_md；圖片匯入用 doc_image


class RewriteItemRequest(BaseModel):
    question: str
    answer: str
    instruction: str
    model: str = ""


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

# JSON schema：強制 LLM 輸出符合格式的 Q&A array（constrained decoding）
_QA_JSON_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "Q": {"type": "string"},
            "A": {"type": "string"},
        },
        "required": ["Q", "A"],
        "additionalProperties": False,
    },
}
_QA_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {"name": "qa_list", "schema": _QA_JSON_SCHEMA},
}


def _split_text(text: str) -> list[str]:
    """依字數切分文字，超過 _CHUNK_SIZE 才切；相鄰段落保留 _CHUNK_OVERLAP 重疊。"""
    if len(text) <= _CHUNK_SIZE:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + _CHUNK_SIZE, len(text))
        if end < len(text):
            # 盡量在段落換行處截斷
            break_pos = text.rfind("\n", start + _CHUNK_SIZE // 2, end)
            if break_pos > start:
                end = break_pos + 1
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - _CHUNK_OVERLAP
    return chunks


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _table_to_markdown(table: list[list]) -> str:
    """將 pdfplumber 抓到的二維陣列轉成 Markdown 表格字串。"""
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


def _extract_text_pdfplumber(pdf_bytes: bytes) -> tuple[str, int]:
    """用 pdfplumber 萃取純文字（含 Markdown 表格），回傳 (text, page_count)。"""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page_count = len(pdf.pages)
        parts: list[str] = []
        for i, page in enumerate(pdf.pages):
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

            if segments:
                parts.append(f"[第 {i + 1} 頁]\n" + "\n\n".join(segments))

    return "\n\n".join(parts), page_count


def _collapse_spaced_text(text: str) -> str:
    """修正 fpdf2 CIDFont 產生的「每字元間有空格」問題。"""
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
    """pypdf 備援萃取（處理 CIDFont 類 PDF，如 fpdf2 輸出）。"""
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


def _extract_text(pdf_bytes: bytes) -> tuple[str, int]:
    """從 PDF 萃取純文字，表格自動轉為 Markdown，回傳 (text, page_count)。
    策略：pdfplumber（主，支援表格）→ pypdf（備援，支援 CIDFont）。
    """
    text, page_count = _extract_text_pdfplumber(pdf_bytes)
    if len(text.strip()) < 50:
        fallback = _extract_text_pypdf(pdf_bytes)
        if len(fallback) > len(text):
            logger.info("pdfplumber 萃取不足，改用 pypdf 備援（%d 字）", len(fallback))
            text = fallback
    return text, page_count


def _extract_json_candidate(text: str) -> str:
    """從文字中取出最外層 JSON object 或 array 字串"""
    cleaned = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
    # 優先找 object { ... }
    obj_start = cleaned.find("{")
    obj_end = cleaned.rfind("}")
    # 也試試 array [ ... ]
    arr_start = cleaned.find("[")
    arr_end = cleaned.rfind("]")
    # 取最先出現的那種
    if obj_start == -1 and arr_start == -1:
        raise ValueError("LLM 回覆中找不到合法 JSON")
    if obj_start != -1 and (arr_start == -1 or obj_start <= arr_start):
        if obj_end == -1:
            raise ValueError("LLM 回覆中找不到合法 JSON")
        return cleaned[obj_start:obj_end + 1]
    if arr_end == -1:
        raise ValueError("LLM 回覆中找不到合法 JSON")
    return cleaned[arr_start:arr_end + 1]


def _coerce_qa_item(item: dict) -> dict:
    """將各種命名的 Q&A item 正規化成 {question, answer}。
    支援：question/answer、Q/A（大寫）、q/a（小寫）、問題/答案 等變體。
    """
    question = (
        item.get("question")
        or item.get("Question")
        or item.get("Q")
        or item.get("q")
        or item.get("問題")
        or ""
    )
    answer = (
        item.get("answer")
        or item.get("Answer")
        or item.get("A")
        or item.get("a")
        or item.get("答案")
        or ""
    )
    return {"question": str(question).strip(), "answer": str(answer).strip()}


def _items_from_list(raw: list) -> list[dict]:
    """將 list 中的每個 dict 正規化為 {question, answer} 並補 id。"""
    flat = []
    for item in raw:
        if isinstance(item, dict):
            flat.append(_coerce_qa_item(item))
    for idx, item in enumerate(flat, 1):
        item.setdefault("id", idx)
    return flat


def _normalize_items(data: dict | list) -> list[dict]:
    """從 LLM 回傳的各種 JSON 格式中萃取 Q&A items。"""
    if isinstance(data, list):
        return _items_from_list(data)

    _top_keys = ("items", "Q&A", "qa_pairs", "questions", "data")
    for key in _top_keys:
        if key in data and isinstance(data[key], list):
            return _items_from_list(data[key])

    # 嵌套：qa_content[*].questions[*]
    flat: list[dict] = []
    for section in data.get("qa_content", data.get("categories", data.get("sections", []))):
        if not isinstance(section, dict):
            continue
        for q in section.get("questions", section.get("qa", [])):
            if isinstance(q, dict):
                flat.append(_coerce_qa_item(q))
    for idx, item in enumerate(flat, 1):
        item.setdefault("id", idx)
    return flat


def _extract_text_from_file(file_bytes: bytes, filename: str) -> tuple[str, int]:
    """從上傳的檔案萃取純文字，回傳 (text, page_count)。
    支援 PDF（pdfplumber + pypdf）與 TXT（UTF-8）。
    """
    if filename.lower().endswith(".txt"):
        try:
            text = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            text = file_bytes.decode("utf-8", errors="replace")
        # 以每 2000 字估算頁數（僅用於進度顯示）
        page_count = max(1, len(text) // 2000)
        return text, page_count
    # 預設走 PDF 解析
    return _extract_text(file_bytes)


def _fix_llm_json(s: str) -> str:
    """修正 LLM 常見的 JSON 語法問題：trailing comma。"""
    s = re.sub(r",(\s*[}\]])", r"\1", s)
    return s


def _parse_llm_json(raw: str) -> list[dict]:
    """從 LLM 回覆中萃取並正規化 Q&A items 列表。"""
    try:
        json_str = _extract_json_candidate(raw)
        json_str = _fix_llm_json(json_str)
        data = json.loads(json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM 回覆 JSON 解析失敗：{exc}") from exc

    return _normalize_items(data)


def _generate_pdf(mode: str, title: str, items: list[dict]) -> bytes:
    """用 fpdf2 產生中文 PDF，回傳 bytes。"""
    from fpdf import FPDF, XPos, YPos

    pdf = FPDF()
    pdf.set_margins(20, 20, 20)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    if _FONT_PATH.exists():
        pdf.add_font("NotoSansTC", "", str(_FONT_PATH))
        font = "NotoSansTC"
    else:
        font = "Helvetica"
        logger.warning("中文字型未找到，退回 Helvetica")

    # 標題
    pdf.set_font(font, size=18)
    pdf.cell(0, 12, title or "整理文件", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)

    # 副標
    pdf.set_font(font, size=10)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 6, "Q&A 格式", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(6)

    # 分隔線
    pdf.set_draw_color(200, 200, 200)
    pdf.line(20, pdf.get_y(), 190, pdf.get_y())
    pdf.ln(6)

    for item in items:
        idx = item.get("id", "")
        q = str(item.get("question", ""))
        a = str(item.get("answer", ""))

        pdf.set_font(font, size=12)
        pdf.set_fill_color(240, 248, 255)
        pdf.set_text_color(30, 64, 175)
        pdf.multi_cell(0, 7, f"Q{idx}. {q}", fill=True,
                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(1)

        pdf.set_font(font, size=11)
        pdf.set_fill_color(255, 255, 255)
        pdf.set_text_color(30, 30, 30)
        pdf.multi_cell(0, 7, f"A. {a}",
                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(5)

    return bytes(pdf.output())


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/process", summary="整理文件（SSE 串流）")
async def process_document(
    file: UploadFile = File(..., description="原始 PDF 或 TXT 檔案"),
    model: str = Form("", description="指定 LLM model（留空使用租戶預設）"),
    source_type: str = Form("doc", description="來源類型：doc（文件）或 note（筆記）"),
    granularity: str = Form("key_points", description="整理粒度：summary / key_points / detailed"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """上傳 PDF 或 TXT，以 SSE 串流逐段回傳 Q&A 整理結果。"""

    fname = (file.filename or "").lower()
    if not (fname.endswith(".pdf") or fname.endswith(".txt")):
        raise HTTPException(status_code=400, detail="僅支援 PDF 或 TXT 格式")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="上傳的檔案是空的")
    if len(file_bytes) > _MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="檔案過大（上限 20 MB）")

    # 萃取文字
    try:
        raw_text, page_count = _extract_text_from_file(file_bytes, file.filename or "")
    except Exception as exc:
        logger.error("文字萃取失敗: %s", exc)
        raise HTTPException(status_code=400, detail=f"檔案解析失敗，請確認檔案完整性：{exc}") from exc

    if not raw_text.strip():
        if fname.endswith(".pdf"):
            raise HTTPException(status_code=400, detail="無法從 PDF 萃取文字（可能是純圖片 PDF，請先跑 OCR）")
        raise HTTPException(status_code=400, detail="TXT 檔案內容為空")

    char_count = len(raw_text)

    # 決定 model（前端指定 > 租戶預設）
    use_model = model.strip()
    if not use_model:
        from app.models.llm_provider_config import LLMProviderConfig
        cfg = (
            db.query(LLMProviderConfig)
            .filter(
                LLMProviderConfig.tenant_id == current.tenant_id,
                LLMProviderConfig.is_active.is_(True),
            )
            .order_by(LLMProviderConfig.id)
            .first()
        )
        if cfg:
            dm = (cfg.default_model or "").strip()
            provider = cfg.provider
            if provider == "gemini":
                use_model = dm if dm.startswith("gemini/") else f"gemini/{dm}" if dm else "gemini/gemini-2.0-flash"
            elif provider == "local":
                use_model = dm if dm.startswith("local/") else f"local/{dm}" if dm else ""
            elif provider == "twcc":
                use_model = dm if dm.startswith("twcc/") else f"twcc/{dm}" if dm else ""
            else:
                use_model = dm or "gpt-4o-mini"
        if not use_model:
            raise HTTPException(status_code=400, detail="請指定 model 參數，或在 AI 設定中設定 LLM Provider")

    filename = (file.filename or "文件").rsplit(".", 1)[0]
    if source_type == "note":
        prompt_key = "doc_refiner_note"
    elif source_type == "sop":
        prompt_key = "doc_refiner_sop"
    else:
        prompt_key = "doc_refiner_doc"
    system_prompt = _load_system_prompt_from_file(prompt_key) or ""

    # 根據整理粒度，在 system prompt 末尾附加數量指令
    _GRANULARITY_INSTRUCTIONS = {
        "summary":    "【數量限制】本次只產生 1 條 Q&A，以整份文件的核心主旨為題。",
        "key_points": "【數量限制】本次產生 3–5 條 Q&A，挑選最重要的關鍵資訊。",
        "detailed":   "【數量限制】本次盡量涵蓋所有重要知識點，不限數量。",
    }
    granularity_inst = _GRANULARITY_INSTRUCTIONS.get(granularity, _GRANULARITY_INSTRUCTIONS["key_points"])
    system_prompt = system_prompt.rstrip() + "\n\n" + granularity_inst

    chunks = _split_text(raw_text)
    chunk_total = len(chunks)

    tenant_id = current.tenant_id

    async def generate():
        yield _sse({"type": "meta", "page_count": page_count, "char_count": char_count, "chunk_total": chunk_total})

        total_pt = total_ct = total_tt = 0
        item_id = 1

        try:
            for idx, chunk_text in enumerate(chunks, 1):
                messages = [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": (
                            f"請將以下文件整理成 Q&A 格式。\n"
                            f"文件名稱：{filename}"
                            + (f"（第 {idx}/{chunk_total} 段）" if chunk_total > 1 else "")
                            + f"\n\n--- 文件內容開始 ---\n{chunk_text}\n--- 文件內容結束 ---\n\n"
                            f"請直接輸出 JSON array，以 [ 開頭，以 ] 結尾，不要有任何前言或 Markdown 格式。"
                        ),
                    },
                ]

                # local model 用 JSON schema constrained decoding 確保輸出合法
                llm_extra: dict = {}
                if use_model.startswith("local/"):
                    llm_extra["response_format"] = _QA_RESPONSE_FORMAT

                try:
                    answer, llm_usage, _ = await call_llm(
                        model=use_model,
                        messages=messages,
                        db=db,
                        tenant_id=tenant_id,
                        temperature=0.3,
                        **llm_extra,
                    )
                except (LLMProviderNotConfigured, LLMCallError) as exc:
                    yield _sse({"type": "error", "detail": str(exc)})
                    return
                except Exception as exc:
                    logger.error("call_llm 非預期例外 chunk %d: %s", idx, exc)
                    yield _sse({"type": "error", "detail": f"AI 呼叫失敗：{exc}"})
                    return

                # 累計 usage
                if llm_usage:
                    total_pt += getattr(llm_usage, "prompt_tokens", 0) or 0
                    total_ct += getattr(llm_usage, "completion_tokens", 0) or 0
                    total_tt += getattr(llm_usage, "total_tokens", 0) or 0

                logger.info("chunk %d/%d raw answer (first 400): %s", idx, chunk_total, answer[:400])
                try:
                    items = _parse_llm_json(answer)
                except (ValueError, json.JSONDecodeError) as exc:
                    logger.error("chunk %d JSON 解析失敗: %s", idx, exc)
                    yield _sse({"type": "chunk_error", "chunk": idx, "detail": f"第 {idx} 段解析失敗，略過"})
                    continue
                for item in items:
                    item["id"] = item_id
                    item_id += 1

                logger.info("chunk %d done, items=%d", idx, len(items))
                yield _sse({"type": "items", "chunk": idx, "chunk_total": chunk_total, "items": items})

            yield _sse({
                "type": "done",
                "model": use_model,
                "usage": {"prompt_tokens": total_pt, "completion_tokens": total_ct, "total_tokens": total_tt},
            })
        except Exception as exc:
            logger.error("generate() 非預期例外: %s", exc)
            yield _sse({"type": "error", "detail": f"處理失敗：{exc}"})

    return StreamingResponse(generate(), media_type="text/event-stream")


def _detect_pdf_mode(file_bytes: bytes) -> str:
    """偵測 PDF 類型，回傳建議萃取模式：'text' 或 'image'。
    策略：以全份 PDF 的平均每頁非空白字數判斷。
    - 平均 >= 80 字/頁 → 'text'（有足夠文字層）
    - 平均 < 80 字/頁 → 'image'（掃描型或圖片型）
    封面、空白頁會拉低平均值，但文字型 PDF 整體平均仍遠高於門檻。
    """
    import pdfplumber

    try:
        total_chars = 0
        page_count = 0
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                text = page.extract_text() or ""
                total_chars += len(re.sub(r"\s+", "", text))

        if page_count == 0:
            return "image"

        avg_chars = total_chars / page_count
        logger.info("_detect_pdf_mode: total_chars=%d, pages=%d, avg=%.1f", total_chars, page_count, avg_chars)
        return "text" if avg_chars >= 80 else "image"

    except Exception as exc:
        logger.warning("_detect_pdf_mode 失敗，fallback image: %s", exc)
        return "image"


@router.post("/check-pdf", summary="快速偵測 PDF 類型（文字型 / 圖片型 / 混合型）")
async def check_pdf(
    file: UploadFile = File(..., description="PDF 檔案"),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """分析 PDF 各頁的文字層與圖片分佈，回傳：
    - type: "text" | "image" | "mixed"
    - page_count: 頁數
    - ocr_pages_estimate: 預估需要 OCR 的頁數
    """
    import fitz
    import pdfplumber

    file_bytes = await file.read()
    try:
        fitz_doc = fitz.open(stream=file_bytes, filetype="pdf")
        page_count = fitz_doc.page_count
        ocr_needed = 0

        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for i, plumb_page in enumerate(pdf.pages):
                fitz_page = fitz_doc[i]
                page_area = fitz_page.rect.width * fitz_page.rect.height

                text = plumb_page.extract_text() or ""
                chars = len(re.sub(r"\s+", "", text))

                seen: set[int] = set()
                max_ratio = 0.0
                for img in fitz_page.get_images(full=True):
                    xref = int(img[0])
                    if xref in seen:
                        continue
                    seen.add(xref)
                    try:
                        rects = fitz_page.get_image_rects(xref)
                        if rects and page_area > 0:
                            ratio = max(r.width * r.height for r in rects) / page_area
                            max_ratio = max(max_ratio, ratio)
                    except Exception:
                        pass

                is_full_page_render = max_ratio > 0.75
                # 有全頁大圖 + 文字層幾乎空白才算掃描頁
                if is_full_page_render and chars < 50:
                    ocr_needed += 1

        fitz_doc.close()

        if ocr_needed == 0:
            pdf_type = "text"
        elif ocr_needed == page_count:
            pdf_type = "image"
        else:
            pdf_type = "mixed"

        return {"type": pdf_type, "page_count": page_count, "ocr_pages_estimate": ocr_needed}

    except Exception as exc:
        logger.warning("check_pdf 失敗: %s", exc)
        return {"type": "unknown", "page_count": 0, "ocr_pages_estimate": 0}


@router.post("/to-markdown", summary="文件轉結構化 Markdown（SSE 串流）")
async def to_markdown(
    file: UploadFile = File(..., description="原始 PDF 檔案"),
    model: str = Form("", description="指定 LLM model（留空使用租戶預設）"),
    pdf_mode: str = Form("text", description="PDF 萃取模式：text（文字層）/ image（整頁 OCR）/ auto（自動偵測）"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """上傳 PDF，以 LLM 補上章節標題（## / ###），輸出結構化 Markdown。
    SSE 事件：
      { type: "extract_progress", page, page_count, stage, detail }  # OCR 進行中
      { type: "meta",     page_count, char_count, chunk_total }
      { type: "md_chunk", chunk, chunk_total, content }  # 首 chunk 含 YAML front matter
      { type: "done",     model, usage }
      { type: "error",    detail }
    """
    from app.services.document_service import is_supported_filename
    from app.services.document_structuring import DocumentStructuringService

    fname = file.filename or ""
    if not is_supported_filename(fname):
        raise HTTPException(status_code=400, detail="僅支援 PDF 格式（Word、網頁請先匯出 PDF）")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="上傳的檔案是空的")
    if len(file_bytes) > _MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="檔案過大（上限 20 MB）")

    # auto 模式：同步偵測 PDF 類型（輕量，幾乎不影響速度）
    effective_mode = pdf_mode
    if pdf_mode == "auto":
        effective_mode = _detect_pdf_mode(file_bytes)
        logger.info("auto 偵測結果：%s → 使用 %s 模式", fname, effective_mode)

    svc = DocumentStructuringService()

    async def generate():
        queue: asyncio.Queue = asyncio.Queue()

        async def on_progress(event: dict) -> None:
            await queue.put(event)

        async def run_extract() -> None:
            try:
                result = await svc.extract_async(
                    file_bytes,
                    fname,
                    mode=effective_mode,
                    model=model,
                    db=db,
                    tenant_id=current.tenant_id,
                    on_progress=on_progress,
                )
                await queue.put({"_extract_done": result})
            except ValueError as exc:
                await queue.put({"_extract_error": str(exc)})
            except Exception as exc:
                logger.error("MD 模式文字萃取失敗: %s", exc)
                await queue.put({"_extract_error": f"檔案解析失敗，請確認檔案完整性：{exc}"})

        extract_task = asyncio.create_task(run_extract())

        while True:
            item = await queue.get()
            if "_extract_done" in item:
                extracted = item["_extract_done"]
                break
            if "_extract_error" in item:
                yield _sse({"type": "error", "detail": item["_extract_error"]})
                await extract_task
                return
            yield _sse(item)

        await extract_task

        if not extracted.text.strip():
            fmt_hint = "PDF" if fname.lower().endswith(".pdf") else "檔案"
            yield _sse(
                {
                    "type": "error",
                    "detail": f"無法從 {fmt_hint} 萃取文字（含 OCR 補強後仍無內容，可能是空白文件）",
                }
            )
            return

        async for event in svc.structure_stream(
            extracted,
            model=model,
            db=db,
            tenant_id=current.tenant_id,
        ):
            yield _sse(event)

    return StreamingResponse(generate(), media_type="text/event-stream")


class WebPreviewRequest(BaseModel):
    url: str


class WebPreviewResponse(BaseModel):
    source_url: str
    title: str
    content_html: str
    preview_html: str
    text_length: int
    excerpt: str


@router.post("/web/preview", response_model=WebPreviewResponse, summary="擷取網頁正文預覽")
async def web_preview(
    body: WebPreviewRequest,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """抓取公開 URL，抽取正文 HTML 供前端預覽（已去除常見雜訊）。"""
    from app.services.web_to_md_service import WebFetchError, fetch_web_preview

    try:
        preview = await fetch_web_preview(body.url)
    except WebFetchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("web preview failed: %s", exc)
        raise HTTPException(status_code=502, detail="網頁擷取失敗，請稍後再試") from exc

    return WebPreviewResponse(
        source_url=preview.source_url,
        title=preview.title,
        content_html=preview.content_html,
        preview_html=preview.preview_html,
        text_length=preview.text_length,
        excerpt=preview.excerpt,
    )


_MAX_WEB_HTML_CHARS = 2 * 1024 * 1024


@router.post("/web/to-markdown", summary="網頁正文轉結構化 Markdown（SSE 串流）")
async def web_to_markdown(
    source_url: str = Form(..., description="原始網頁 URL"),
    title: str = Form("", description="文件標題"),
    content_html: str = Form(..., description="確認後的正文 HTML"),
    model: str = Form("", description="指定 LLM model（留空使用租戶預設）"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """將預覽確認過的 HTML 確定性轉為結構化 Markdown（不走 PDF / LLM）。"""
    from app.services.web_to_md_service import (
        WebFetchError,
        build_web_structured_markdown_async,
        validate_public_url,
    )

    html_body = (content_html or "").strip()
    if not html_body:
        raise HTTPException(status_code=400, detail="正文 HTML 不可為空")
    if len(html_body) > _MAX_WEB_HTML_CHARS:
        raise HTTPException(status_code=413, detail="HTML 內容過大")

    try:
        normalized_url = validate_public_url(source_url)
    except WebFetchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    doc_title = (title or "").strip() or "webpage"

    async def generate():
        yield _sse({"type": "extract_progress", "page": 1, "page_count": 1, "stage": "html", "detail": "轉換 Markdown…"})

        try:
            md_content = await build_web_structured_markdown_async(
                html_body,
                title=doc_title,
                original_file=normalized_url,
                source_url=normalized_url,
            )
        except WebFetchError as exc:
            yield _sse({"type": "error", "detail": str(exc)})
            return
        except Exception as exc:
            logger.error("web html_to_md failed: %s", exc)
            yield _sse({"type": "error", "detail": f"Markdown 轉換失敗：{exc}"})
            return

        char_count = len(md_content)
        yield _sse({
            "type": "meta",
            "page_count": 1,
            "char_count": char_count,
            "chunk_total": 1,
            "ocr_pages": [],
        })
        yield _sse({
            "type": "md_chunk",
            "chunk": 1,
            "chunk_total": 1,
            "content": md_content,
        })
        yield _sse({
            "type": "done",
            "model": "deterministic",
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        })

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/import-md-to-kb", response_model=ImportToKBResponse, summary="將結構化 MD 匯入知識庫")
async def import_md_to_kb(
    body: ImportMdToKBRequest,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """將 Doc Refiner 生成的結構化 Markdown 匯入知識庫，使用 structured_md chunk 策略。"""
    from app.models.km_knowledge_base import KmKnowledgeBase
    from app.models.km_document import KmDocument
    from app.services.km_service import process_document
    import uuid as _uuid

    if not body.markdown.strip():
        raise HTTPException(status_code=400, detail="Markdown 內容不可為空")
    if body.kb_id is None and not body.new_kb_name:
        raise HTTPException(status_code=400, detail="請指定 kb_id 或提供 new_kb_name")

    # ── 1. 取得或建立 KB ──────────────────────────────
    if body.kb_id is not None:
        kb = db.query(KmKnowledgeBase).filter(
            KmKnowledgeBase.id == body.kb_id,
            KmKnowledgeBase.tenant_id == current.tenant_id,
        ).first()
        if not kb:
            raise HTTPException(status_code=404, detail="知識庫不存在")
        can_manage = current.role in ("admin", "super_admin", "manager")
        is_admin = current.role in ("admin", "super_admin")
        if kb.scope == "company" and not can_manage:
            raise HTTPException(status_code=403, detail="只有管理員可匯入到公司共用知識庫")
        if kb.scope == "personal" and kb.created_by != current.id and not is_admin:
            raise HTTPException(status_code=403, detail="只能匯入到自己的知識庫")
    else:
        kb = KmKnowledgeBase(
            tenant_id=current.tenant_id,
            name=body.new_kb_name.strip(),
            scope="personal",
            created_by=current.id,
            public_token=str(_uuid.uuid4()),
        )
        db.add(kb)
        db.commit()
        db.refresh(kb)

    # ── 2. 建立 KmDocument 並處理 ─────────────────────
    md_bytes = body.markdown.encode("utf-8")
    doc_filename = f"{(body.title or 'document').strip()}.md"
    scope = "public" if kb.scope == "company" else "private"
    owner_id = current.id if scope == "private" else None

    effective_doc_type = body.doc_type if body.doc_type in ("structured_md", "doc_image", "faq", "spec", "article") else "structured_md"
    doc = KmDocument(
        tenant_id=current.tenant_id,
        owner_user_id=owner_id,
        filename=doc_filename,
        content_type="text/markdown",
        size_bytes=len(md_bytes),
        scope=scope,
        status="pending",
        knowledge_base_id=kb.id,
        doc_type=effective_doc_type,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    process_document(
        doc_id=doc.id,
        text=md_bytes.decode("utf-8"),
        db=db,
        tenant_id=current.tenant_id,
        doc_type=effective_doc_type,
        agent_id="doc-refiner",
        user_id=current.id,
    )
    db.refresh(doc)

    return ImportToKBResponse(
        kb_id=kb.id,
        kb_name=kb.name,
        doc_id=doc.id,
        imported_count=doc.chunk_count or 0,
    )


@router.post("/export-txt", summary="匯出整理結果為純文字")
async def export_txt(
    body: ExportRequest,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """將 Q&A 條目輸出為 FAQ 格式純文字，可直接上傳至知識庫。"""
    if not body.items:
        raise HTTPException(status_code=400, detail="沒有可匯出的內容")

    lines: list[str] = []
    for item in body.items:
        q = str(item.get("question") or "").strip()
        a = str(item.get("answer") or "").strip()
        if q or a:
            lines.append(f"Q: {q}\nA: {a}")
    content = "\n\n".join(lines)

    safe_title = re.sub(r'[^\w\u4e00-\u9fff\-]', '_', body.title)[:40] or "qa"
    ascii_name = re.sub(r'[^\x20-\x7e]', '_', safe_title) + ".txt"
    utf8_name = "".join(f"%{b:02X}" for b in safe_title.encode("utf-8")) + ".txt"

    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf8_name}"},
    )


@router.post("/import-to-kb", response_model=ImportToKBResponse, summary="將 Q&A 匯入知識庫")
async def import_to_kb(
    body: ImportToKBRequest,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """將整理後的 Q&A 條目以 FAQ 格式寫入指定知識庫（或建立新 KB 後寫入）。"""
    from app.models.km_knowledge_base import KmKnowledgeBase
    from app.models.km_document import KmDocument
    from app.services.km_service import process_document
    import uuid as _uuid

    if not body.items:
        raise HTTPException(status_code=400, detail="沒有可匯入的 Q&A 條目")
    if body.kb_id is None and not body.new_kb_name:
        raise HTTPException(status_code=400, detail="請指定 kb_id 或提供 new_kb_name")

    # ── 1. 取得或建立 KB ──────────────────────────────
    if body.kb_id is not None:
        kb = db.query(KmKnowledgeBase).filter(
            KmKnowledgeBase.id == body.kb_id,
            KmKnowledgeBase.tenant_id == current.tenant_id,
        ).first()
        if not kb:
            raise HTTPException(status_code=404, detail="知識庫不存在")
        is_admin = current.role in ("admin", "super_admin")
        can_manage = current.role in ("admin", "super_admin", "manager")
        if kb.scope == "company" and not can_manage:
            raise HTTPException(status_code=403, detail="只有管理員可匯入到公司共用知識庫")
        if kb.scope == "personal" and kb.created_by != current.id and not is_admin:
            raise HTTPException(status_code=403, detail="只能匯入到自己的知識庫")
    else:
        kb = KmKnowledgeBase(
            tenant_id=current.tenant_id,
            name=body.new_kb_name.strip(),
            scope="personal",
            created_by=current.id,
            public_token=str(_uuid.uuid4()),
        )
        db.add(kb)
        db.commit()
        db.refresh(kb)

    # ── 2. Q&A items → FAQ 純文字 ──────────────────────
    lines: list[str] = []
    for item in body.items:
        q = str(item.get("question") or item.get("Q") or "").strip()
        a = str(item.get("answer") or item.get("A") or "").strip()
        if q or a:
            lines.append(f"Q: {q}\nA: {a}")
    faq_text = "\n\n".join(lines)
    if not faq_text.strip():
        raise HTTPException(status_code=400, detail="所有條目皆為空，無法匯入")

    faq_bytes = faq_text.encode("utf-8")
    doc_filename = f"{body.title or 'qa'}.txt"
    scope = "public" if kb.scope == "company" else "private"
    owner_id = current.id if scope == "private" else None

    # ── 3. 建立 KmDocument 並處理 ─────────────────────
    doc = KmDocument(
        tenant_id=current.tenant_id,
        owner_user_id=owner_id,
        filename=doc_filename,
        content_type="text/plain",
        size_bytes=len(faq_bytes),
        scope=scope,
        status="pending",
        knowledge_base_id=kb.id,
        doc_type="faq",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    process_document(
        doc_id=doc.id,
        text=faq_text,
        db=db,
        tenant_id=current.tenant_id,
        doc_type="faq",
        agent_id="doc-refiner",
        user_id=current.id,
    )
    db.refresh(doc)

    return ImportToKBResponse(
        kb_id=kb.id,
        kb_name=kb.name,
        doc_id=doc.id,
        imported_count=len(lines),
    )


@router.post("/export", summary="匯出整理後 PDF")
async def export_pdf(
    body: ExportRequest,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """接收整理後的 JSON，產生 PDF 並以串流回傳。"""
    if not body.items:
        raise HTTPException(status_code=400, detail="沒有可匯出的內容")

    try:
        pdf_bytes = _generate_pdf("qa", body.title, body.items)
    except Exception as exc:
        logger.error("PDF 生成失敗: %s", exc)
        raise HTTPException(status_code=500, detail=f"PDF 生成失敗：{exc}") from exc

    safe_title = re.sub(r'[^\w\u4e00-\u9fff\-]', '_', body.title)[:40] or "document"
    ascii_name = re.sub(r'[^\x20-\x7e]', '_', safe_title) + ".pdf"
    utf8_name = "".join(f"%{b:02X}" for b in safe_title.encode("utf-8")) + ".pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf8_name}"},
    )


# ──────────────────────────────────────────────────────────────────────────────
# AI 改寫單條 Q&A
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/rewrite-item", summary="AI 改寫單條 Q&A")
async def rewrite_item(
    body: RewriteItemRequest,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """根據指示改寫一條 Q&A，回傳新的 question / answer。"""
    system_prompt = _load_system_prompt_from_file("doc_refiner_rewrite") or ""

    use_model = body.model.strip()
    if not use_model:
        from app.models.llm_provider_config import LLMProviderConfig
        cfg = (
            db.query(LLMProviderConfig)
            .filter(
                LLMProviderConfig.tenant_id == current.tenant_id,
                LLMProviderConfig.is_active.is_(True),
            )
            .order_by(LLMProviderConfig.id)
            .first()
        )
        if cfg:
            dm = (cfg.default_model or "").strip()
            provider = cfg.provider
            if provider == "gemini":
                use_model = dm if dm.startswith("gemini/") else f"gemini/{dm}" if dm else "gemini/gemini-2.0-flash"
            elif provider == "local":
                use_model = dm if dm.startswith("local/") else f"local/{dm}" if dm else ""
            elif provider == "twcc":
                use_model = dm if dm.startswith("twcc/") else f"twcc/{dm}" if dm else ""
            else:
                use_model = dm or "gpt-4o-mini"
    if not use_model:
        raise HTTPException(status_code=400, detail="請指定 model 參數，或在 AI 設定中設定 LLM Provider")

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"原始 Q&A：\n"
                f"Q: {body.question}\n"
                f"A: {body.answer}\n\n"
                f"改寫指示：{body.instruction}\n\n"
                f"請直接輸出 JSON，以 {{ 開頭，以 }} 結尾，不要有任何前言或 Markdown 格式。"
            ),
        },
    ]

    try:
        answer, _, _ = await call_llm(
            model=use_model,
            messages=messages,
            db=db,
            tenant_id=current.tenant_id,
            temperature=0.4,
        )
    except (LLMProviderNotConfigured, LLMCallError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # 解析 JSON
    raw = answer.strip()
    # 移除可能的 ```json ... ``` 包裝
    if raw.startswith("```"):
        raw = re.sub(r"^```[^\n]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    try:
        obj = json.loads(raw)
        return {
            "question": str(obj.get("Q") or obj.get("question") or body.question).strip(),
            "answer": str(obj.get("A") or obj.get("answer") or body.answer).strip(),
        }
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail=f"AI 回傳格式錯誤：{raw[:200]}")
