"""Widget API：無需登入，以 public_token 驗證知識庫存取"""
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator

import litellm
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.km_knowledge_base import KmKnowledgeBase
from app.models.widget_session import WidgetSession
from app.services.km_service import format_km_context, km_retrieve_sync
from app.services.llm_service import _get_llm_params, _get_provider_name
from app.services.llm_utils import apply_api_base
from app.services.chat_service import _load_system_prompt_from_file

router = APIRouter()
logger = logging.getLogger(__name__)


# ── helpers ──────────────────────────────────────────────────────────────────


def _get_kb_by_token(token: str, db: Session) -> KmKnowledgeBase:
    kb = db.query(KmKnowledgeBase).filter(KmKnowledgeBase.public_token == token).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Widget 不存在或已停用")
    return kb


# ── Schemas ───────────────────────────────────────────────────────────────────


class WidgetInfoResponse(BaseModel):
    kb_id: int
    title: str
    logo_url: str | None
    color: str
    lang: str

    model_config = {"from_attributes": True}


class SessionCreateRequest(BaseModel):
    session_id: str
    visitor_name: str | None = None
    visitor_email: str | None = None
    visitor_phone: str | None = None


class SessionResponse(BaseModel):
    session_id: str
    visitor_name: str | None
    visitor_email: str | None
    visitor_phone: str | None
    created_at: str


class WidgetChatRequest(BaseModel):
    session_id: str
    messages: list[dict] = []
    content: str


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/{token}/info", response_model=WidgetInfoResponse)
def widget_info(token: str, db: Session = Depends(get_db)):
    """取得 Widget 基本設定（title、logo、主色、語言）"""
    kb = _get_kb_by_token(token, db)
    return WidgetInfoResponse(
        kb_id=kb.id,
        title=kb.widget_title or kb.name,
        logo_url=kb.widget_logo_url,
        color=kb.widget_color or "#1A3A52",
        lang=kb.widget_lang or "zh-TW",
    )


@router.post("/{token}/session", response_model=SessionResponse, status_code=201)
def create_or_update_session(
    token: str,
    body: SessionCreateRequest,
    db: Session = Depends(get_db),
):
    """建立或更新 Widget Session（訪客資訊）"""
    kb = _get_kb_by_token(token, db)

    session = db.query(WidgetSession).filter(WidgetSession.id == body.session_id).first()
    if session:
        if body.visitor_name is not None:
            session.visitor_name = body.visitor_name
        if body.visitor_email is not None:
            session.visitor_email = body.visitor_email
        if body.visitor_phone is not None:
            session.visitor_phone = body.visitor_phone
        session.last_active_at = datetime.now(timezone.utc)
    else:
        session = WidgetSession(
            id=body.session_id,
            kb_id=kb.id,
            visitor_name=body.visitor_name,
            visitor_email=body.visitor_email,
            visitor_phone=body.visitor_phone,
        )
        db.add(session)

    db.commit()
    db.refresh(session)
    return SessionResponse(
        session_id=session.id,
        visitor_name=session.visitor_name,
        visitor_email=session.visitor_email,
        visitor_phone=session.visitor_phone,
        created_at=session.created_at.isoformat(),
    )


@router.post("/{token}/chat")
async def widget_chat(
    token: str,
    body: WidgetChatRequest,
    db: Session = Depends(get_db),
):
    """Widget 對話（SSE streaming）"""
    kb = _get_kb_by_token(token, db)

    if not kb.model_name:
        raise HTTPException(
            status_code=400,
            detail="此知識庫尚未設定模型，請聯繫管理員",
        )

    # 更新 session last_active_at
    session = db.query(WidgetSession).filter(WidgetSession.id == body.session_id).first()
    if session:
        session.last_active_at = datetime.now(timezone.utc)
        db.commit()

    # RAG 取參考資料
    context_text = ""
    try:
        chunks = km_retrieve_sync(
            query=body.content,
            tenant_id=kb.tenant_id,
            db=db,
            knowledge_base_id=kb.id,
            skip_scope_check=True,
        )
        if chunks:
            context_text = format_km_context(chunks, show_source=False)
    except Exception as e:
        logger.warning("Widget RAG 失敗，略過參考資料: %s", e)

    # 組 messages
    msgs: list[dict] = []
    system_parts: list[str] = []

    # KB 自訂 system prompt 優先，否則用預設 CS prompt 檔
    if kb.system_prompt:
        system_parts.append(kb.system_prompt)
    else:
        file_prompt = _load_system_prompt_from_file("cs")
        if file_prompt:
            system_parts.append(file_prompt)

    if context_text:
        system_parts.append(f"以下為參考資料：\n\n{context_text}")

    if system_parts:
        msgs.append({"role": "system", "content": "\n\n".join(system_parts)})

    for m in body.messages:
        msgs.append({"role": m["role"], "content": m["content"]})

    msgs.append({"role": "user", "content": body.content})

    # LLM params
    litellm_model, api_key, api_base = _get_llm_params(
        kb.model_name, db=db, tenant_id=kb.tenant_id
    )
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=f"{_get_provider_name(kb.model_name)} API Key 未設定",
        )

    async def generate() -> AsyncIterator[str]:
        try:
            kwargs: dict = {
                "model": litellm_model,
                "messages": msgs,
                "stream": True,
                "api_key": api_key,
                "temperature": 0.3,
            }
            apply_api_base(kwargs, api_base)

            response = await litellm.acompletion(**kwargs)
            full_text = ""
            async for chunk in response:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    full_text += delta
                    yield f"data: {json.dumps({'event': 'delta', 'text': delta}, ensure_ascii=False)}\n\n"

            yield f"data: {json.dumps({'event': 'done', 'content': full_text}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error("Widget chat 錯誤: %s", e)
            yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
