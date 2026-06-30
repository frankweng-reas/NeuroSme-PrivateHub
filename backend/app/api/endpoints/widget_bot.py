"""Widget Bot API：以 Bot public_token 驗證，無需登入"""
import json
import logging
import time
from datetime import datetime, timezone
from typing import AsyncIterator

import httpx
import jwt
import litellm
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.models.bot import Bot, BotKnowledgeBase
from app.models.bot_widget_session import BotWidgetMessage, BotWidgetSession
from app.services.agent_usage import log_agent_usage
from app.services.bot_content_service import (
    BotContentContactLink,
    BotContentFaqItem,
    build_bot_content,
)
from app.services.bot_rag_service import apply_bot_fallback, prepare_bot_rag_messages, rag_hit
from app.services.llm_caller import LLMProviderNotConfigured, build_llm_kwargs, resolve_llm_params

router = APIRouter()
logger = logging.getLogger(__name__)


# ── helpers ───────────────────────────────────────────────────────────────────


def _get_bot_by_token(token: str, db: Session) -> Bot:
    bot = db.query(Bot).filter(Bot.public_token == token).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Widget 不存在或已停用")
    if not bot.is_active:
        raise HTTPException(status_code=403, detail="此 Bot 已停用")
    return bot


def _verify_widget_auth(request: Request, bot: Bot) -> dict | None:
    """若 Bot 為 authenticated 模式，驗證 LocalAuth JWT；否則放行。
    回傳 JWT payload（含 sub/email），或 None（public 模式）。"""
    if (bot.access_mode or "public") != "authenticated":
        return None
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="此 Widget 需要登入，請提供 Authorization Token")
    token = auth_header[len("Bearer "):]
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="登入已過期，請重新登入")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="無效的 Token，請重新登入")
    return payload


# ── Schemas ───────────────────────────────────────────────────────────────────


# 與 bot_content_service 共用 schema（Widget API 向後相容別名）
BotWidgetFaqItem = BotContentFaqItem
BotWidgetContactLink = BotContentContactLink


class BotWidgetInfoResponse(BaseModel):
    bot_id: int
    title: str
    logo_url: str | None
    color: str
    lang: str
    is_active: bool
    voice_enabled: bool
    access_mode: str                         # 'public' | 'authenticated'
    # 客服情境
    home_enabled: bool
    home_greeting: str | None
    home_quick_questions: list[str]
    popular_faq_enabled: bool
    common_faq_enabled: bool
    popular_faqs: list[BotWidgetFaqItem]
    common_faqs: list[BotWidgetFaqItem]
    contact_enabled: bool
    contact_links: list[BotWidgetContactLink]

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


class BotWidgetChatRequest(BaseModel):
    session_id: str
    messages: list[dict] = []
    content: str


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/{token}/info", response_model=BotWidgetInfoResponse)
def bot_widget_info(token: str, db: Session = Depends(get_db)):
    """取得 Bot Widget 基本設定（含客服情境首頁面 / FAQ）"""
    bot = _get_bot_by_token(token, db)
    content = build_bot_content(bot, db)

    return BotWidgetInfoResponse(
        **content.model_dump(),
        is_active=bot.is_active,
        voice_enabled=bot.widget_voice_enabled or False,
        access_mode=bot.access_mode or "public",
    )


class WidgetLoginRequest(BaseModel):
    email: str
    password: str


class WidgetLoginResponse(BaseModel):
    access_token: str
    user_email: str
    user_name: str | None = None


@router.post("/{token}/auth/login", response_model=WidgetLoginResponse)
async def widget_auth_login(token: str, body: WidgetLoginRequest, db: Session = Depends(get_db)):
    """Authenticated Bot Widget 登入（代理至 LocalAuth）"""
    bot = _get_bot_by_token(token, db)
    if (bot.access_mode or "public") != "authenticated":
        raise HTTPException(status_code=400, detail="此 Widget 為公開模式，無需登入")

    localauth_url = (settings.LOCALAUTH_ADMIN_URL or "").rstrip("/")
    if not localauth_url:
        raise HTTPException(status_code=503, detail="LocalAuth 服務未設定")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{localauth_url}/auth/login",
                json={"email": body.email, "password": body.password},
            )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="無法連線至認證服務，請聯繫管理員")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="認證服務逾時")

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")
    if resp.status_code == 403:
        data = resp.json()
        raise HTTPException(status_code=403, detail=data.get("message", "帳號無存取權限"))
    if resp.status_code != 200 and resp.status_code != 201:
        raise HTTPException(status_code=502, detail="認證服務異常，請稍後再試")

    data = resp.json()
    access_token = data.get("access_token") or data.get("accessToken") or ""
    if not access_token:
        raise HTTPException(status_code=502, detail="認證服務回應異常")

    try:
        payload = jwt.decode(access_token, settings.JWT_SECRET, algorithms=["HS256"])
        user_email = payload.get("email", body.email)
        user_name = payload.get("name") or data.get("name")
    except Exception:
        user_email = body.email
        user_name = None

    return WidgetLoginResponse(
        access_token=access_token,
        user_email=user_email,
        user_name=user_name,
    )


@router.get("/{token}/session/{session_id}")
def check_session(token: str, session_id: str, request: Request, db: Session = Depends(get_db)):
    bot = _get_bot_by_token(token, db)
    _verify_widget_auth(request, bot)
    session = db.query(BotWidgetSession).filter(
        BotWidgetSession.id == session_id,
        BotWidgetSession.bot_id == bot.id,
    ).first()
    return {"valid": session is not None}


@router.post("/{token}/session", response_model=SessionResponse, status_code=201)
def create_or_update_session(
    token: str,
    body: SessionCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    bot = _get_bot_by_token(token, db)
    _verify_widget_auth(request, bot)

    session = db.query(BotWidgetSession).filter(BotWidgetSession.id == body.session_id).first()
    if session:
        if body.visitor_name is not None:
            session.visitor_name = body.visitor_name
        if body.visitor_email is not None:
            session.visitor_email = body.visitor_email
        if body.visitor_phone is not None:
            session.visitor_phone = body.visitor_phone
        session.last_active_at = datetime.now(timezone.utc)
    else:
        session = BotWidgetSession(
            id=body.session_id,
            bot_id=bot.id,
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
async def bot_widget_chat(
    token: str,
    body: BotWidgetChatRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Bot Widget 對話（SSE streaming）"""
    bot = _get_bot_by_token(token, db)
    _verify_widget_auth(request, bot)

    bot_id: int = bot.id
    bot_tenant_id: str = bot.tenant_id
    bot_model_name: str = (bot.model_name or "").strip()
    # 在 session 關閉前先抽出 bot 屬性，避免 generate() 中 DetachedInstanceError
    bot_fallback_message: str | None = (bot.fallback_message or "").strip() or None
    bot_fallback_message_enabled: bool = bot.fallback_message_enabled or False

    if not bot_model_name:
        raise HTTPException(status_code=400, detail="此 Bot 尚未設定模型，請聯繫管理員")

    try:
        _bot_resolved = resolve_llm_params(bot_model_name, db=db, tenant_id=bot_tenant_id)
    except LLMProviderNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    bot_canonical_model = _bot_resolved.canonical_model_id or bot_model_name

    # 共用 RAG 邏輯：多 KB 檢索 + system prompt + messages 組裝
    history = [{"role": m["role"], "content": m["content"]} for m in body.messages]
    bot_ctx = prepare_bot_rag_messages(
        bot,
        body.content,
        history,
        db,
        bot_tenant_id,
        skip_scope_check=True,
        agent_id="kb-bot-builder",
        max_history_turns=6,
        show_source_in_context=False,  # Widget 不在 LLM context 顯示來源標注
    )
    msgs = bot_ctx.messages
    _bot_chunk_ids = bot_ctx.context_chunk_ids
    _faq_direct = bot_ctx.is_faq_direct and bool(bot_ctx.faq_candidates)
    _faq_candidates = bot_ctx.faq_candidates or []

    session = db.query(BotWidgetSession).filter(BotWidgetSession.id == body.session_id).first()
    if session:
        session.last_active_at = datetime.now(timezone.utc)
    db.add(BotWidgetMessage(session_id=body.session_id, role="user", content=body.content))
    db.commit()

    session_id = body.session_id
    tenant_id_for_log = bot_tenant_id

    async def generate() -> AsyncIterator[str]:
        t0 = time.perf_counter()
        llm_status = "success"
        usage_out: tuple[int, int, int] | None = None

        # FAQ direct 模式：LLM 選題 → 回傳原文，不重新生成答案
        if _faq_direct:
            from app.api.endpoints.chat import _clean_rag_response
            from app.services.km_service import km_faq_llm_select, extract_faq_question, extract_faq_answer
            if _faq_candidates and bot_model_name:
                selected, _, _ = await km_faq_llm_select(
                    body.content, _faq_candidates, bot_model_name, db, bot_tenant_id,
                )
            else:
                selected = _faq_candidates
            if not selected:
                raw_text = "[NOT_FOUND]"
            else:
                parts = []
                for chunk, _ in selected:
                    q = extract_faq_question(chunk.content)
                    a = extract_faq_answer(chunk.content)
                    parts.append(f"**Q: {q}**\n\n{a}" if q else a)
                raw_text = "\n\n---\n\n".join(parts)
            clean_text = _clean_rag_response(
                raw_text, "cs",
                fallback_message=bot_fallback_message,
                fallback_message_enabled=bot_fallback_message_enabled,
            )
            yield f"data: {json.dumps({'event': 'done', 'content': clean_text}, ensure_ascii=False)}\n\n"
            try:
                db.add(BotWidgetMessage(session_id=session_id, role="assistant", content=clean_text))
                db.commit()
            except Exception as save_err:
                logger.warning("儲存 FAQ direct 訊息失敗: %s", save_err)
            return

        # 若無任何 RAG context 且 fallback 已啟用 → 直接回傳 fallback，不呼叫 LLM
        if not _bot_chunk_ids and bot_fallback_message_enabled and bot_fallback_message:
            clean_text = bot_fallback_message.strip()
            yield f"data: {json.dumps({'event': 'done', 'content': clean_text}, ensure_ascii=False)}\n\n"
            try:
                db.add(BotWidgetMessage(session_id=session_id, role="assistant", content=clean_text))
                db.commit()
            except Exception as save_err:
                logger.warning("儲存 fallback 訊息失敗: %s", save_err)
            return

        try:
            kwargs = build_llm_kwargs(
                model=bot_model_name,
                messages=msgs,
                db=db,
                tenant_id=bot_tenant_id,
                stream=True,
                stream_options={"include_usage": True},
            )
            response = await litellm.acompletion(**kwargs)
            full_text = ""
            async for chunk in response:
                if not chunk.choices:
                    u = getattr(chunk, "usage", None)
                    if u is not None:
                        try:
                            usage_out = (
                                int(getattr(u, "prompt_tokens", None) or 0),
                                int(getattr(u, "completion_tokens", None) or 0),
                                int(getattr(u, "total_tokens", None) or 0),
                            )
                        except (TypeError, ValueError):
                            pass
                    continue
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    full_text += delta
                    yield f"data: {json.dumps({'event': 'delta', 'text': delta}, ensure_ascii=False)}\n\n"
                u = getattr(chunk, "usage", None)
                if u is not None:
                    try:
                        pt = getattr(u, "prompt_tokens", None)
                        ct = getattr(u, "completion_tokens", None)
                        tt = getattr(u, "total_tokens", None)
                        if pt is not None or ct is not None or tt is not None:
                            usage_out = (int(pt or 0), int(ct or 0), int(tt or 0))
                    except (TypeError, ValueError):
                        pass

            from app.api.endpoints.chat import _clean_rag_response
            # 若 context chunks 為空（無知識庫內容可參考），且已啟用 fallback，
            # 不論 LLM 輸出為何（可能不遵守 [NOT_FOUND] 指令），直接套用 fallback。
            if bot_fallback_message_enabled and bot_fallback_message and not _bot_chunk_ids:
                clean_text = bot_fallback_message.strip()
            else:
                clean_text = _clean_rag_response(
                    full_text,
                    "cs",
                    fallback_message=bot_fallback_message,
                    fallback_message_enabled=bot_fallback_message_enabled,
                )
            yield f"data: {json.dumps({'event': 'done', 'content': clean_text}, ensure_ascii=False)}\n\n"

            if full_text:
                try:
                    db.add(BotWidgetMessage(session_id=session_id, role="assistant", content=clean_text))
                    db.commit()
                except Exception as save_err:
                    logger.warning("儲存 assistant 訊息失敗: %s", save_err)
        except Exception as e:
            llm_status = "error"
            logger.error("Bot Widget chat 錯誤: %s", e)
            yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"
        finally:
            s = SessionLocal()
            try:
                log_agent_usage(
                    db=s,
                    agent_type="kb-bot-builder",
                    tenant_id=tenant_id_for_log,
                    model=bot_canonical_model,
                    prompt_tokens=usage_out[0] if usage_out else None,
                    completion_tokens=usage_out[1] if usage_out else None,
                    total_tokens=usage_out[2] if usage_out else None,
                    latency_ms=int((time.perf_counter() - t0) * 1000),
                    status=llm_status,
                )
                s.commit()
            except Exception as log_err:
                logger.warning("Bot Widget LLM usage log 失敗: %s", log_err)

            # Layer 2：記錄 Bot 查詢結果
            try:
                from app.services.bot_rag_service import rag_hit as _rag_hit_fn
                from app.services.km_service import log_bot_query
                _hit = _rag_hit_fn(full_text, _bot_chunk_ids)
                log_bot_query(
                    s,
                    tenant_id=tenant_id_for_log,
                    bot_id=bot_id,
                    session_id=session_id,
                    query=body.content or "",
                    hit=_hit,
                )
                s.commit()
            except Exception as log_err:
                logger.warning("Bot Widget bot_query_log 寫入失敗: %s", log_err)
            finally:
                s.close()

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── 語音轉文字 ─────────────────────────────────────────────────────────────────

_BOT_WIDGET_SPEECH_MAX_BYTES = 25 * 1024 * 1024


class BotWidgetSpeechResponse(BaseModel):
    text: str
    language: str = ""
    duration: float = 0.0


@router.post("/{token}/speech", response_model=BotWidgetSpeechResponse)
async def bot_widget_speech(
    token: str,
    file: UploadFile,
    request: Request,
    language: str | None = None,
    db: Session = Depends(get_db),
):
    """Bot Widget 語音轉文字（以 public_token 驗證，使用租戶語音設定）"""
    from app.models.tenant_config import TenantConfig

    bot = _get_bot_by_token(token, db)
    _verify_widget_auth(request, bot)
    tenant_id = bot.tenant_id
    tc = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant_id).first()

    provider = (tc and tc.speech_provider) or ""
    if not provider:
        raise HTTPException(status_code=503, detail="此 Widget 尚未啟用語音功能，請管理員在「AI 設定」中設定語音模型")

    model = (tc and tc.speech_model) or (
        "whisper-1" if provider == "openai" else "Systran/faster-whisper-medium"
    )

    api_key = None
    if provider == "local":
        # 本機 faster-whisper-server
        base_url = (tc.speech_base_url or "").rstrip("/")
        if not base_url:
            raise HTTPException(status_code=503, detail="語音服務 Base URL 未設定")
        if tc.speech_api_key_encrypted:
            try:
                from app.core.encryption import decrypt_api_key
                api_key = decrypt_api_key(tc.speech_api_key_encrypted)
            except Exception:
                logger.warning("bot widget speech: API key 解密失敗")
    else:
        # 自訂 provider（openai 或 custom:{id}）：從 LLMProviderConfig 讀取
        from app.core.encryption import decrypt_api_key
        from app.models.llm_provider_config import LLMProviderConfig

        if provider.startswith("custom:"):
            config_id = int(provider.split(":")[1])
            llm_cfg = (
                db.query(LLMProviderConfig)
                .filter(
                    LLMProviderConfig.tenant_id == tenant_id,
                    LLMProviderConfig.id == config_id,
                    LLMProviderConfig.is_active.is_(True),
                )
                .first()
            )
            if not llm_cfg:
                raise HTTPException(status_code=503, detail=f"找不到 Provider 設定（id={config_id}），請重新設定語音服務")
        else:
            llm_cfg = (
                db.query(LLMProviderConfig)
                .filter(
                    LLMProviderConfig.tenant_id == tenant_id,
                    LLMProviderConfig.provider == provider,
                    LLMProviderConfig.is_active.is_(True),
                )
                .first()
            )
            if not llm_cfg or not llm_cfg.api_key_encrypted:
                raise HTTPException(status_code=503, detail=f"語音功能需要 {provider} API Key，請管理員設定")

        try:
            api_key = decrypt_api_key(llm_cfg.api_key_encrypted)
        except Exception:
            raise HTTPException(status_code=500, detail="API Key 解密失敗")
        # api_base_url 已含 /v1，空則補預設
        base_url = (llm_cfg.api_base_url or "https://api.openai.com/v1").rstrip("/")

    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="音頻檔案為空")
    if len(audio_bytes) > _BOT_WIDGET_SPEECH_MAX_BYTES:
        raise HTTPException(status_code=413, detail="音頻檔案過大（上限 25 MB）")

    filename = file.filename or "audio.webm"
    content_type = (file.content_type or "audio/webm").lower()
    logger.info("bot widget speech: token=%s tenant=%s size=%d", token[:8], tenant_id, len(audio_bytes))

    headers: dict = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    voice_prompt = bot.widget_voice_prompt or ""
    post_data: dict = {
        "model": model,
        "response_format": "verbose_json",
        "temperature": "0",
        "prompt": voice_prompt or "以下是繁體中文的語音記錄。",
    }
    if language:
        post_data["language"] = language
    if provider == "local":
        post_data["vad_filter"] = "true"
        if voice_prompt:
            post_data["hotwords"] = voice_prompt

    # local: base_url 不含 /v1，需補；custom/openai: api_base_url 已含 /v1
    transcribe_url = f"{base_url}/v1/audio/transcriptions" if provider == "local" else f"{base_url}/audio/transcriptions"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                transcribe_url,
                headers=headers,
                files={"file": (filename, audio_bytes, content_type)},
                data=post_data,
            )
        if resp.status_code != 200:
            logger.error("bot widget speech: whisper error %d: %s", resp.status_code, resp.text[:300])
            raise HTTPException(status_code=502, detail=f"語音轉文字服務異常（{resp.status_code}）")
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=503, detail="無法連線至語音轉文字服務") from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="語音轉文字服務逾時") from exc

    data = resp.json()
    try:
        import opencc
        s2tw = opencc.OpenCC("s2twp")
        text = s2tw.convert((data.get("text") or "").strip())
    except Exception:
        text = (data.get("text") or "").strip()
    lang_out = data.get("language") or ""
    duration = float(data.get("duration") or 0.0)
    return BotWidgetSpeechResponse(text=text, language=lang_out, duration=duration)
