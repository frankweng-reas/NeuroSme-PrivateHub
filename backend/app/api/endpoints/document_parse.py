"""Document Parse API：文件結構化解析

端點：
  POST /api/v1/document-parse/parse  — 上傳 PDF，依 Parse Profile 萃取結構化欄位（SSE 串流）
  GET  /api/v1/document-parse/profiles — 列出可用 Parse Profile
"""
import io
import json
import logging
import re
from pathlib import Path
from typing import Annotated

import pdfplumber
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.doc_parse_profile import DocParseProfile
from app.models.doc_parse_result import DocParseResult
from app.models.llm_provider_config import LLMProviderConfig
from app.models.user import User
from app.services.chat_service import _load_system_prompt_from_file
from app.services.llm_caller import LLMCallError, LLMProviderNotConfigured, call_llm

router = APIRouter()
logger = logging.getLogger(__name__)

_MAX_PDF_BYTES  = 20 * 1024 * 1024  # 20 MB
_CHUNK_SIZE     = 24_000             # 每段字數；減少 LLM 呼叫次數，品質由模型決定
_CHUNK_OVERLAP  = 500                # 相鄰段落重疊字數
_LOCAL_NUM_CTX  = 131_072            # Ollama context window（128K；gemma4:26b 原生 256K）


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic schemas
# ──────────────────────────────────────────────────────────────────────────────

class ProfileSummary(BaseModel):
    id: str
    name: str


class ProfileDetail(BaseModel):
    id: str
    name: str
    definition: dict


class ProfileUpsertRequest(BaseModel):
    profile_id: str
    profile_name: str
    definition: dict


class ResultSummary(BaseModel):
    id: int
    profile_id: str
    profile_name: str
    file_name: str
    page_count: int | None
    model: str
    created_at: str  # ISO 8601


class ResultDetail(ResultSummary):
    sections: list
    usage: dict | None


class ResultFieldPatch(BaseModel):
    """單一欄位值修改請求。"""
    section_id: str
    field_key: str
    value: str | list | None   # scalar 或 list（text_list / doc_list）


# ──────────────────────────────────────────────────────────────────────────────
# Profile DB helpers
# ──────────────────────────────────────────────────────────────────────────────

def _get_profile_or_404(db: Session, profile_id: str) -> DocParseProfile:
    row = (
        db.query(DocParseProfile)
        .filter(DocParseProfile.profile_id == profile_id, DocParseProfile.is_active.is_(True))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"找不到解析設定：{profile_id}")
    return row


def _profile_to_dict(row: DocParseProfile) -> dict:
    """將 DB row 的 definition 補上頂層 profile_id / profile_name，與原 JSON 格式相容。"""
    data = dict(row.definition)
    data["profile_id"]   = row.profile_id
    data["profile_name"] = row.profile_name
    return data


# ──────────────────────────────────────────────────────────────────────────────
# PDF 萃取（與 doc_refiner 相同策略）
# ──────────────────────────────────────────────────────────────────────────────

def _table_to_markdown(table: list[list]) -> str:
    rows = [[str(cell or "").strip() for cell in row] for row in table if any(cell for cell in row)]
    if not rows:
        return ""
    header = rows[0]
    body = rows[1:]
    sep = ["---"] * len(header)
    lines = (
        ["| " + " | ".join(header) + " |", "| " + " | ".join(sep) + " |"]
        + ["| " + " | ".join(row) + " |" for row in body]
    )
    return "\n".join(lines)


def _extract_text(pdf_bytes: bytes) -> tuple[str, int]:
    """pdfplumber 主萃取（含 Markdown 表格），回傳 (text, page_count)。"""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page_count = len(pdf.pages)
        parts: list[str] = []
        for i, page in enumerate(pdf.pages):
            tables = page.find_tables()
            table_bboxes = [t.bbox for t in tables]
            segments: list[str] = []
            for t in tables:
                md = _table_to_markdown(t.extract())
                if md:
                    segments.append(md)
            if table_bboxes:
                words = page.extract_words()
                non_table = [
                    w["text"] for w in words
                    if not any(
                        w["x0"] >= bx0 and w["top"] >= by0
                        and w["x1"] <= bx1 and w["bottom"] <= by1
                        for bx0, by0, bx1, by1 in table_bboxes
                    )
                ]
                plain = " ".join(non_table).strip()
            else:
                plain = (page.extract_text() or "").strip()
            if plain:
                segments.insert(0, plain)
            if segments:
                parts.append(f"[第 {i + 1} 頁]\n" + "\n\n".join(segments))
    return "\n\n".join(parts), page_count


def _split_text(text: str) -> list[str]:
    if len(text) <= _CHUNK_SIZE:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + _CHUNK_SIZE, len(text))
        if end < len(text):
            bp = text.rfind("\n", start + _CHUNK_SIZE // 2, end)
            if bp > start:
                end = bp + 1
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - _CHUNK_OVERLAP
    return chunks


# ──────────────────────────────────────────────────────────────────────────────
# LLM Prompt 組裝
# ──────────────────────────────────────────────────────────────────────────────

def _build_field_list(profile: dict) -> list[dict]:
    """攤平所有 section 的 fields 成一個列表。"""
    fields = []
    for section in profile.get("sections", []):
        for f in section.get("fields", []):
            fields.append(f)
    return fields


def _build_prompt(
    profile: dict,
    chunk_text: str,
    chunk_idx: int,
    chunk_total: int,
    custom_instruction: str = "",
) -> list[dict]:
    """組裝 LLM messages。

    system  → system_prompt_document_parse.md（身份 + 輸出規則）
    user    → [自訂指令] + 欄位清單（來自 profile） + 文件段落
    """
    fields = _build_field_list(profile)
    field_desc_lines = []
    for f in fields:
        ftype = f.get("type", "text")
        val_fmt = "string[]" if ftype in ("text_list", "doc_list") else "string"
        field_desc_lines.append(
            f'  "{f["key"]}": {{"value": {val_fmt} | null, "cite": string | null}}'
            f'  // {f["label"]}：{f["hint"]}'
        )

    field_block = "\n".join(field_desc_lines)
    chunk_note = f"（第 {chunk_idx}/{chunk_total} 段）" if chunk_total > 1 else ""

    system = _load_system_prompt_from_file("document_parse") or (
        "你是一個政府採購標案文件分析助手，擅長從招標文件中準確萃取結構化資訊。\n"
        "請嚴格依據文件內容作答，禁止虛構或猜測；找不到或無法確認的欄位請輸出 null。"
    )

    # user prompt：自訂指令（未來由使用者填寫）+ 欄位清單 + 文件
    custom_block = f"{custom_instruction.strip()}\n\n" if custom_instruction.strip() else ""
    user = (
        f"{custom_block}"
        f"請從以下文件段落{chunk_note}中萃取指定欄位，輸出 JSON object。\n\n"
        f"【欄位定義】\n{{\n{field_block}\n}}\n\n"
        f"【文件段落】\n{chunk_text}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


# ──────────────────────────────────────────────────────────────────────────────
# 結果合併
# ──────────────────────────────────────────────────────────────────────────────

def _init_results(profile: dict) -> dict:
    # 每個 key 的值結構：{"value": ..., "cite": ...} 或 None
    return {f["key"]: None for f in _build_field_list(profile)}


def _extract_json(raw: str) -> dict:
    cleaned = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("LLM 回覆中找不到合法 JSON object")
    return json.loads(cleaned[start:end + 1])


def _is_list_field(profile: dict, key: str) -> bool:
    for f in _build_field_list(profile):
        if f["key"] == key:
            return f.get("type", "text") in ("text_list", "doc_list")
    return False


def _unpack(raw) -> tuple:
    """從 LLM 回傳的欄位值中拆出 (value, cite)。
    支援兩種格式：
      - 新格式：{"value": ..., "cite": ...}
      - 舊格式（純值）：直接作為 value，cite = None
    """
    if isinstance(raw, dict):
        return raw.get("value"), raw.get("cite")
    return raw, None


def _merge(results: dict, chunk_data: dict, profile: dict) -> None:
    """合併 chunk 結果到 results：scalar 取第一個非 null；list 累加去重。
    results[key] 結構：{"value": ..., "cite": str | None} 或 None
    """
    for key, raw in chunk_data.items():
        if key not in results:
            continue
        value, cite = _unpack(raw)
        if value is None or value == "" or value == []:
            continue
        if _is_list_field(profile, key):
            existing_entry = results[key] or {"value": [], "cite": None}
            existing_list = existing_entry["value"] if isinstance(existing_entry, dict) else []
            existing_cite  = existing_entry.get("cite") if isinstance(existing_entry, dict) else None
            new_cite = existing_cite  # 保留已有 cite，以第一個有 cite 的 item 為準

            if isinstance(value, list):
                for item in value:
                    # item 可能是純字串，也可能是 {"value": "...", "cite": "..."} dict
                    if isinstance(item, dict):
                        item_val  = item.get("value")
                        item_cite = item.get("cite")
                    else:
                        item_val  = item
                        item_cite = None

                    s = str(item_val).strip() if item_val else ""
                    if s and s not in existing_list:
                        existing_list.append(s)
                    if item_cite and not new_cite:
                        new_cite = item_cite
            elif isinstance(value, str) and value.strip() and value.strip() not in existing_list:
                existing_list.append(value.strip())

            results[key] = {"value": existing_list if existing_list else None, "cite": new_cite or cite}
        else:
            if results[key] is None:
                v = str(value).strip() if value else None
                results[key] = {"value": v, "cite": cite}


def _format_sections(profile: dict, results: dict) -> list[dict]:
    sections = []
    for section in profile.get("sections", []):
        fields = []
        for f in section.get("fields", []):
            key = f["key"]
            entry = results.get(key)   # {"value": ..., "cite": ...} 或 None
            is_list = _is_list_field(profile, key)

            if isinstance(entry, dict):
                val = entry.get("value")
                cite = entry.get("cite")
            else:
                val = entry
                cite = None

            not_found = val is None or val == [] or (isinstance(val, str) and not val.strip())
            fields.append({
                "key": key,
                "label": f["label"],
                "type": f.get("type", "text"),
                "value": ([] if is_list else None) if not_found else val,
                "cite": cite,
                "not_found": not_found,
            })
        sections.append({"id": section["id"], "label": section["label"], "fields": fields})
    return sections


# ──────────────────────────────────────────────────────────────────────────────
# SSE helpers
# ──────────────────────────────────────────────────────────────────────────────

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/profiles", response_model=list[ProfileSummary], summary="列出可用解析設定")
def list_profiles(
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    rows = (
        db.query(DocParseProfile)
        .filter(DocParseProfile.is_active.is_(True))
        .order_by(DocParseProfile.id)
        .all()
    )
    return [ProfileSummary(id=r.profile_id, name=r.profile_name) for r in rows]


@router.get("/profiles/{profile_id}", response_model=ProfileDetail, summary="取得 Profile 完整定義")
def get_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    row = _get_profile_or_404(db, profile_id)
    return ProfileDetail(id=row.profile_id, name=row.profile_name, definition=row.definition)


@router.post("/profiles", response_model=ProfileDetail, summary="新增 Parse Profile")
def create_profile(
    body: ProfileUpsertRequest,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    existing = db.query(DocParseProfile).filter(DocParseProfile.profile_id == body.profile_id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"profile_id 已存在：{body.profile_id}")
    row = DocParseProfile(
        profile_id=body.profile_id,
        profile_name=body.profile_name,
        definition=body.definition,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ProfileDetail(id=row.profile_id, name=row.profile_name, definition=row.definition)


@router.put("/profiles/{profile_id}", response_model=ProfileDetail, summary="更新 Parse Profile")
def update_profile(
    profile_id: str,
    body: ProfileUpsertRequest,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    row = _get_profile_or_404(db, profile_id)
    row.profile_name = body.profile_name
    row.definition   = body.definition
    db.commit()
    db.refresh(row)
    return ProfileDetail(id=row.profile_id, name=row.profile_name, definition=row.definition)


@router.delete("/profiles/{profile_id}", summary="刪除 Parse Profile")
def delete_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    row = _get_profile_or_404(db, profile_id)
    row.is_active = False
    db.commit()
    return {"detail": "已刪除"}


@router.post("/parse", summary="文件結構化解析（SSE 串流）")
async def parse_document(
    file: UploadFile = File(..., description="待解析的 PDF 檔案"),
    profile_id: str = Form(..., description="解析設定 ID，例如 tender-gov-tw"),
    model: str = Form(default="", description="指定 LLM 模型（留空使用租戶預設）"),
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    """上傳 PDF，依 Profile 設定以 SSE 串流逐段解析並回傳結構化欄位。"""
    fname = (file.filename or "").lower()
    if not fname.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="目前僅支援 PDF 格式")

    file_bytes = await file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="上傳的檔案是空的")
    if len(file_bytes) > _MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="檔案過大（上限 20 MB）")

    profile = _profile_to_dict(_get_profile_or_404(db, profile_id))

    try:
        raw_text, page_count = _extract_text(file_bytes)
    except Exception as exc:
        logger.error("PDF 萃取失敗: %s", exc)
        raise HTTPException(status_code=400, detail=f"PDF 解析失敗：{exc}") from exc

    if not raw_text.strip():
        raise HTTPException(status_code=400, detail="無法從 PDF 萃取文字（可能是純圖片 PDF，請先跑 OCR）")

    # 決定 model
    use_model = model.strip()
    if not use_model:
        cfg = (
            db.query(LLMProviderConfig)
            .filter(
                LLMProviderConfig.tenant_id == current_user.tenant_id,
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

    is_local = use_model.startswith("local/") or use_model.startswith("ollama_chat/")
    chunks = _split_text(raw_text)
    chunk_total = len(chunks)
    char_count = len(raw_text)
    tenant_id = current_user.tenant_id

    logger.info(
        "document_parse: user=%s profile=%s file=%s pages=%d chars=%d chunks=%d model=%s",
        current_user.id, profile_id, file.filename, page_count, char_count, chunk_total, use_model,
    )

    async def generate():
        yield _sse({
            "type": "meta",
            "profile_name": profile["profile_name"],
            "page_count": page_count,
            "char_count": char_count,
            "chunk_total": chunk_total,
            "num_ctx": _LOCAL_NUM_CTX if is_local else None,
        })

        results = _init_results(profile)
        total_pt = total_ct = total_tt = 0

        extra_kwargs: dict = {}
        if is_local:
            extra_kwargs["options"] = {"num_ctx": _LOCAL_NUM_CTX}

        for idx, chunk_text in enumerate(chunks, 1):
            yield _sse({"type": "progress", "chunk": idx, "chunk_total": chunk_total,
                        "status": f"解析第 {idx}/{chunk_total} 段…"})

            messages = _build_prompt(profile, chunk_text, idx, chunk_total)
            try:
                answer, llm_usage, _ = await call_llm(
                    model=use_model,
                    messages=messages,
                    db=db,
                    tenant_id=tenant_id,
                    temperature=0.1,
                    **extra_kwargs,
                )
            except (LLMProviderNotConfigured, LLMCallError) as exc:
                yield _sse({"type": "error", "detail": str(exc)})
                return
            except Exception as exc:
                logger.error("call_llm 非預期例外 chunk %d: %s", idx, exc)
                yield _sse({"type": "error", "detail": f"AI 呼叫失敗：{exc}"})
                return

            if llm_usage:
                total_pt += getattr(llm_usage, "prompt_tokens", 0) or 0
                total_ct += getattr(llm_usage, "completion_tokens", 0) or 0
                total_tt += getattr(llm_usage, "total_tokens", 0) or 0

            logger.info("chunk %d/%d raw (first 300): %s", idx, chunk_total, answer[:300])
            try:
                chunk_data = _extract_json(answer)
                _merge(results, chunk_data, profile)
            except (ValueError, json.JSONDecodeError) as exc:
                logger.warning("chunk %d JSON 解析失敗，略過: %s", idx, exc)

        sections_out = _format_sections(profile, results)
        usage_out = {"prompt_tokens": total_pt, "completion_tokens": total_ct, "total_tokens": total_tt}

        # 自動將結果寫入 DB
        try:
            record = DocParseResult(
                user_id=current_user.id,
                tenant_id=tenant_id,
                profile_id=profile_id,
                profile_name=profile["profile_name"],
                file_name=file.filename or "",
                page_count=page_count,
                model=use_model,
                result_json=sections_out,
                usage_json=usage_out,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            result_id: int | None = record.id
        except Exception as exc:
            logger.error("儲存解析結果失敗: %s", exc)
            result_id = None

        yield _sse({
            "type": "done",
            "result_id": result_id,
            "sections": sections_out,
            "usage": usage_out,
            "model": use_model,
        })

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


# ──────────────────────────────────────────────────────────────────────────────
# Results 歷史 API
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/results", response_model=list[ResultSummary], summary="列出當前使用者的解析歷史")
def list_results(
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    rows = (
        db.query(DocParseResult)
        .filter(DocParseResult.user_id == current_user.id)
        .order_by(DocParseResult.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        ResultSummary(
            id=r.id,
            profile_id=r.profile_id,
            profile_name=r.profile_name,
            file_name=r.file_name,
            page_count=r.page_count,
            model=r.model,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]


@router.get("/results/{result_id}", response_model=ResultDetail, summary="取得指定解析結果")
def get_result(
    result_id: int,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    r = db.query(DocParseResult).filter(
        DocParseResult.id == result_id,
        DocParseResult.user_id == current_user.id,
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="找不到此解析結果")
    return ResultDetail(
        id=r.id,
        profile_id=r.profile_id,
        profile_name=r.profile_name,
        file_name=r.file_name,
        page_count=r.page_count,
        model=r.model,
        created_at=r.created_at.isoformat(),
        sections=r.result_json,
        usage=r.usage_json,
    )


@router.delete("/results/{result_id}", summary="刪除指定解析結果")
def delete_result(
    result_id: int,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    r = db.query(DocParseResult).filter(
        DocParseResult.id == result_id,
        DocParseResult.user_id == current_user.id,
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="找不到此解析結果")
    db.delete(r)
    db.commit()
    return {"detail": "已刪除"}


@router.patch("/results/{result_id}/fields", summary="修改指定解析結果的欄位值")
def patch_result_field(
    result_id: int,
    body: ResultFieldPatch,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新 result_json 中特定 section / field 的 value（保留 cite）。"""
    r = db.query(DocParseResult).filter(
        DocParseResult.id == result_id,
        DocParseResult.user_id == current_user.id,
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="找不到此解析結果")

    # 深複製 result_json，避免 JSONB mutation 問題
    import copy
    sections = copy.deepcopy(r.result_json)
    updated = False
    for section in sections:
        if section.get("id") != body.section_id:
            continue
        for field in section.get("fields", []):
            if field.get("key") != body.field_key:
                continue
            field["value"] = body.value
            field["not_found"] = body.value is None or body.value == "" or body.value == []
            updated = True
            break
        if updated:
            break

    if not updated:
        raise HTTPException(status_code=404, detail=f"找不到欄位：{body.section_id}/{body.field_key}")

    from sqlalchemy.orm.attributes import flag_modified
    r.result_json = sections
    flag_modified(r, "result_json")
    db.commit()
    return {"detail": "已更新"}


# ──────────────────────────────────────────────────────────────────────────────
# 投標評估 API（Evaluation）
# ──────────────────────────────────────────────────────────────────────────────

from datetime import date as _date
from app.models.doc_parse_evaluation import DocParseEvaluation


class EvalItemOut(BaseModel):
    id: int
    item_type: str
    item_key: str
    cite: str | None
    sort_order: int
    mandatory: bool | None
    assignee: str | None
    due_date: str | None        # ISO date string
    status: str | None
    capability: str | None
    risk_level: str | None
    note: str | None


class EvalItemPatch(BaseModel):
    mandatory:  bool | None = None
    assignee:   str | None  = None
    due_date:   str | None  = None   # ISO date "YYYY-MM-DD"
    status:     str | None  = None
    capability: str | None  = None
    risk_level: str | None  = None
    note:       str | None  = None


def _result_or_404(db: Session, result_id: int, user_id: int) -> DocParseResult:
    r = db.query(DocParseResult).filter(
        DocParseResult.id == result_id,
        DocParseResult.user_id == user_id,
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="找不到此解析結果")
    return r


def _eval_row_to_out(row: DocParseEvaluation) -> EvalItemOut:
    return EvalItemOut(
        id=row.id,
        item_type=row.item_type,
        item_key=row.item_key,
        cite=row.cite,
        sort_order=row.sort_order,
        mandatory=row.mandatory,
        assignee=row.assignee,
        due_date=row.due_date.isoformat() if row.due_date else None,
        status=row.status,
        capability=row.capability,
        risk_level=row.risk_level,
        note=row.note,
    )


@router.get(
    "/results/{result_id}/evaluation",
    response_model=list[EvalItemOut],
    summary="取得投標評估項目",
)
def get_evaluation(
    result_id: int,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    _result_or_404(db, result_id, current_user.id)
    rows = (
        db.query(DocParseEvaluation)
        .filter(DocParseEvaluation.result_id == result_id)
        .order_by(DocParseEvaluation.item_type, DocParseEvaluation.sort_order)
        .all()
    )
    return [_eval_row_to_out(r) for r in rows]


@router.patch(
    "/results/{result_id}/evaluation/{item_id}",
    response_model=EvalItemOut,
    summary="修改單一評估項目",
)
def patch_evaluation_item(
    result_id: int,
    item_id: int,
    body: EvalItemPatch,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    _result_or_404(db, result_id, current_user.id)
    row = db.query(DocParseEvaluation).filter(
        DocParseEvaluation.id == item_id,
        DocParseEvaluation.result_id == result_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="找不到此評估項目")

    for field, val in body.model_dump(exclude_unset=True).items():
        if field == "due_date":
            setattr(row, field, _date.fromisoformat(val) if val else None)
        else:
            setattr(row, field, val)

    db.commit()
    db.refresh(row)
    return _eval_row_to_out(row)


@router.post(
    "/results/{result_id}/evaluation/classify",
    response_model=list[EvalItemOut],
    summary="AI 初始化投標評估（必附/選附分類 + 技術矩陣建立）",
)
async def classify_evaluation(
    result_id: int,
    db: Session = Depends(get_db),
    current_user: Annotated[User, Depends(get_current_user)] = ...,
):
    """從已儲存的解析結果自動建立評估項目。

    - doc_checklist：取 required_docs，以 AI 判斷必附/選附
    - tech_matrix：取 tech_highlights，全部預設 capability=unknown
    - 若評估已存在，清空重新建立
    """
    r = _result_or_404(db, result_id, current_user.id)

    # 取出 required_docs 與 tech_highlights
    sections: list[dict] = r.result_json or []
    doc_items: list[dict] = []    # {"value": str, "cite": str|None}
    tech_items: list[dict] = []
    risk_items: list[dict] = []

    for sec in sections:
        for field in sec.get("fields", []):
            key = field.get("key", "")
            val = field.get("value")
            cite = field.get("cite")
            if key == "required_docs" and isinstance(val, list):
                for item in val:
                    if item:
                        doc_items.append({"value": str(item), "cite": cite})
            elif key == "tech_highlights" and isinstance(val, list):
                for item in val:
                    if item:
                        tech_items.append({"value": str(item), "cite": cite})
            elif key == "risk_items" and isinstance(val, list):
                for item in val:
                    if item:
                        risk_items.append({"value": str(item), "cite": cite})

    # 決定截止日預設值（投標截止日 -2 天）
    deadline_str: str | None = None
    for sec in sections:
        for field in sec.get("fields", []):
            if field.get("key") == "deadline" and field.get("value"):
                deadline_str = str(field["value"])
                break

    # AI 分類必附/選附
    mandatory_map: dict[str, bool] = {}
    if doc_items:
        mandatory_map = await _classify_mandatory(doc_items, db, current_user.tenant_id)

    # 清除舊評估資料
    db.query(DocParseEvaluation).filter(
        DocParseEvaluation.result_id == result_id
    ).delete()

    new_rows: list[DocParseEvaluation] = []

    for i, item in enumerate(doc_items):
        val = item["value"]
        new_rows.append(DocParseEvaluation(
            result_id=result_id,
            item_type="doc_checklist",
            item_key=val,
            cite=item["cite"],
            sort_order=i,
            mandatory=mandatory_map.get(val),
            status="todo",
        ))

    for i, item in enumerate(tech_items):
        new_rows.append(DocParseEvaluation(
            result_id=result_id,
            item_type="tech_matrix",
            item_key=item["value"],
            cite=item["cite"],
            sort_order=i,
            capability="unknown",
        ))

    for i, item in enumerate(risk_items):
        new_rows.append(DocParseEvaluation(
            result_id=result_id,
            item_type="risk_matrix",
            item_key=item["value"],
            cite=item["cite"],
            sort_order=i,
        ))

    for row in new_rows:
        db.add(row)
    db.commit()

    rows = (
        db.query(DocParseEvaluation)
        .filter(DocParseEvaluation.result_id == result_id)
        .order_by(DocParseEvaluation.item_type, DocParseEvaluation.sort_order)
        .all()
    )
    return [_eval_row_to_out(r) for r in rows]


async def _classify_mandatory(
    doc_items: list[dict],
    db: Session,
    tenant_id: str | None,
) -> dict[str, bool]:
    """使用 LLM 一次性分類所有文件項目為必附(true)或選附(false)。"""
    cfg = (
        db.query(LLMProviderConfig)
        .filter(
            LLMProviderConfig.tenant_id == tenant_id,
            LLMProviderConfig.is_active.is_(True),
        )
        .order_by(LLMProviderConfig.id)
        .first()
    )
    if not cfg:
        # 無 LLM 設定時全部標為必附
        return {item["value"]: True for item in doc_items}

    dm = (cfg.default_model or "").strip()
    provider = cfg.provider
    if provider == "gemini":
        model = dm if dm.startswith("gemini/") else f"gemini/{dm}" if dm else "gemini/gemini-2.0-flash"
    elif provider == "local":
        model = dm if dm.startswith("local/") else f"local/{dm}" if dm else ""
    elif provider == "twcc":
        model = dm if dm.startswith("twcc/") else f"twcc/{dm}" if dm else ""
    else:
        model = dm or "gpt-4o-mini"

    if not model:
        return {item["value"]: True for item in doc_items}

    # 組裝 prompt：一次送全部項目
    items_text = "\n".join(
        f'{i+1}. 文件：{item["value"]}\n   原文依據：{item["cite"] or "（無）"}'
        for i, item in enumerate(doc_items)
    )

    messages = [
        {
            "role": "system",
            "content": (
                "你是政府採購標案文件分析助手。"
                "請根據「原文依據」判斷每份文件是「必附」還是「選附」。\n"
                "判斷依據：\n"
                "- 必附：出現「應檢附」「須繳交」「必須」「強制」「應附」「應提供」等強制字眼\n"
                "- 選附：出現「得免附」「視需要」「選擇性」「如有」「得提供」等選擇字眼\n"
                "- 無法判斷時預設為「必附」\n\n"
                "僅輸出 JSON array，每個元素為 {\"idx\": <編號>, \"mandatory\": true|false}，"
                "禁止輸出任何其他說明文字。"
            ),
        },
        {
            "role": "user",
            "content": f"請分類以下文件項目：\n\n{items_text}",
        },
    ]

    try:
        answer, _, _ = await call_llm(
            model=model,
            messages=messages,
            db=db,
            tenant_id=tenant_id,
            temperature=0.0,
        )
        parsed = _extract_json(answer)
        result: dict[str, bool] = {}
        if isinstance(parsed, list):
            for entry in parsed:
                idx = entry.get("idx", 0) - 1
                if 0 <= idx < len(doc_items):
                    result[doc_items[idx]["value"]] = bool(entry.get("mandatory", True))
        return result
    except Exception as exc:
        logger.warning("mandatory 分類 LLM 失敗，全部預設必附: %s", exc)
        return {item["value"]: True for item in doc_items}
