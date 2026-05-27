"""FB Messenger Webhook：NeuroSme 託管的多租戶 webhook 服務

端點：
  GET  /webhook/fb/{public_token}  — FB Webhook 驗證（hub.challenge）
  POST /webhook/fb/{public_token}  — 接收 FB 訊息事件

每個 Bot 有獨立的 webhook URL（by public_token），客戶只需在 FB Developer Console
填入此 URL 與對應的 verify_token，不需要自行部署任何服務。
"""
import hashlib
import hmac
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.encryption import decrypt_api_key
from app.models.bot import Bot
from app.models.bot_external_user import BotExternalUser
from app.models.bot_widget_session import BotWidgetMessage

router = APIRouter()
logger = logging.getLogger(__name__)

FB_GRAPH_API = "https://graph.facebook.com/v19.0/me/messages"
MAX_HISTORY_TURNS = 10


# ── 工具函式 ──────────────────────────────────────────────────────────────────


def _get_bot_by_token(token: str, db: Session) -> Bot:
    bot = db.query(Bot).filter(Bot.public_token == token).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot 不存在")
    if not bot.is_active:
        raise HTTPException(status_code=403, detail="此 Bot 已停用")
    return bot


def _get_fb_config(bot: Bot) -> dict:
    """從 JSONB 取出 FB 設定；未設定則回傳空 dict。"""
    integrations = bot.messaging_integrations or {}
    return integrations.get("fb", {})


def _verify_fb_signature(body_bytes: bytes, signature_header: str, app_secret: str) -> bool:
    """驗證 FB X-Hub-Signature-256 簽名，防止偽造 webhook。"""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        app_secret.encode(), body_bytes, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)


def _upsert_external_user(
    db: Session,
    *,
    tenant_id: str,
    bot_id: int,
    external_platform: str,
    external_user_id: str,
    display_name: str | None,
) -> BotExternalUser:
    now = datetime.now(timezone.utc)
    user = db.query(BotExternalUser).filter_by(
        bot_id=bot_id,
        external_platform=external_platform,
        external_user_id=external_user_id,
    ).first()
    if user:
        if display_name is not None:
            user.display_name = display_name
        user.last_seen_at = now
    else:
        user = BotExternalUser(
            tenant_id=tenant_id,
            bot_id=bot_id,
            external_platform=external_platform,
            external_user_id=external_user_id,
            display_name=display_name,
            first_seen_at=now,
            last_seen_at=now,
        )
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            user = db.query(BotExternalUser).filter_by(
                bot_id=bot_id,
                external_platform=external_platform,
                external_user_id=external_user_id,
            ).first()
    return user


def _get_conversation_history(db: Session, external_user: BotExternalUser) -> list[dict]:
    """讀取最近 N 輪對話歷史（bot_widget_messages WHERE external_user_fk）。"""
    rows = (
        db.query(BotWidgetMessage)
        .filter(BotWidgetMessage.external_user_fk == external_user.id)
        .order_by(BotWidgetMessage.created_at.desc())
        .limit(MAX_HISTORY_TURNS * 2)
        .all()
    )
    return [{"role": r.role, "content": r.content} for r in reversed(rows)]


def _save_messages(
    db: Session,
    external_user: BotExternalUser,
    user_text: str,
    assistant_text: str,
) -> None:
    db.add(BotWidgetMessage(
        external_user_fk=external_user.id,
        role="user",
        content=user_text,
    ))
    db.add(BotWidgetMessage(
        external_user_fk=external_user.id,
        role="assistant",
        content=assistant_text,
    ))


async def _fetch_fb_display_name(psid: str, page_access_token: str) -> str | None:
    """向 FB Graph API 查詢使用者顯示名稱（靜默失敗）。"""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"https://graph.facebook.com/v19.0/{psid}",
                params={"fields": "first_name,last_name", "access_token": page_access_token},
            )
            data = r.json()
            first = data.get("first_name", "")
            last = data.get("last_name", "")
            return f"{first} {last}".strip() or None
    except Exception:
        return None


async def _send_fb_message(recipient_id: str, text: str, page_access_token: str) -> None:
    """送出純文字訊息給指定 FB 使用者（超過 2000 字自動截斷）。"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                FB_GRAPH_API,
                params={"access_token": page_access_token},
                json={
                    "recipient": {"id": recipient_id},
                    "message": {"text": text[:2000]},
                },
            )
    except Exception as e:
        logger.warning("FB send message 失敗（sender=%s）: %s", recipient_id, e)


async def _call_bot_rag(
    bot: Bot,
    question: str,
    history: list[dict],
    db: Session,
) -> str:
    """呼叫 Bot RAG 服務，回傳 AI 回答。"""
    from app.models.bot import BotKnowledgeBase
    from app.services.bot_rag_service import apply_bot_fallback, prepare_bot_rag_messages, rag_hit
    from app.services.km_service import EmbeddingError
    from app.services.llm_caller import LLMCallError, LLMProviderNotConfigured, call_llm

    kb_links = (
        db.query(BotKnowledgeBase)
        .filter(BotKnowledgeBase.bot_id == bot.id)
        .order_by(BotKnowledgeBase.sort_order)
        .all()
    )
    if not kb_links:
        return bot.fallback_message or "抱歉，目前無法回答您的問題。"

    try:
        bot_ctx = prepare_bot_rag_messages(
            bot, question, history, db, bot.tenant_id,
            skip_scope_check=True,
            agent_id="fb-webhook",
            max_history_turns=MAX_HISTORY_TURNS,
        )
    except EmbeddingError as e:
        logger.error("FB webhook embedding 錯誤 (bot_id=%s): %s", bot.id, e)
        return bot.fallback_message or f"抱歉，知識庫檢索服務暫時不可用。\n（{e}）"

    # FAQ direct 模式
    if bot_ctx.is_faq_direct and bot_ctx.faq_candidates:
        from app.services.km_service import km_faq_llm_select, extract_faq_answer
        model = bot_ctx.model or ""
        if model:
            selected, _, _ = await km_faq_llm_select(
                question, bot_ctx.faq_candidates, model, db, bot.tenant_id,
            )
        else:
            selected = bot_ctx.faq_candidates
        if not selected:
            return apply_bot_fallback("[NOT_FOUND]", bot)
        parts = [extract_faq_answer(chunk.content) for chunk, _ in selected]
        return apply_bot_fallback("\n\n---\n\n".join(parts), bot)

    model = bot_ctx.model or ""
    if not model:
        return bot.fallback_message or "抱歉，目前無法回答您的問題。"

    try:
        answer, _, _ = await call_llm(
            model=model, messages=bot_ctx.messages, db=db, tenant_id=bot.tenant_id,
        )
    except (LLMProviderNotConfigured, LLMCallError) as e:
        logger.error("FB webhook RAG 錯誤 (bot_id=%s): %s", bot.id, e)
        return bot.fallback_message or "抱歉，目前服務發生錯誤，請稍後再試。"

    return apply_bot_fallback(answer, bot)


# ── Webhook 端點 ──────────────────────────────────────────────────────────────


@router.get("/fb/{public_token}", include_in_schema=False)
def fb_webhook_verify(
    public_token: str,
    hub_mode: str = Query(alias="hub.mode", default=""),
    hub_verify_token: str = Query(alias="hub.verify_token", default=""),
    hub_challenge: str = Query(alias="hub.challenge", default=""),
    db: Session = Depends(get_db),
):
    """FB Webhook 驗證端點（GET）。FB Developer Console 設定時呼叫。"""
    bot = _get_bot_by_token(public_token, db)
    fb_config = _get_fb_config(bot)

    if not fb_config.get("enabled"):
        raise HTTPException(status_code=403, detail="此 Bot 尚未啟用 FB 整合")

    if hub_mode == "subscribe" and hub_verify_token == fb_config.get("verify_token"):
        return int(hub_challenge)

    raise HTTPException(status_code=403, detail="Verify token 不符")


@router.post("/fb/{public_token}", include_in_schema=False)
async def fb_webhook_receive(
    public_token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """FB Webhook 訊息接收端點（POST）。"""
    body_bytes = await request.body()
    body = await request.json()

    bot = _get_bot_by_token(public_token, db)
    fb_config = _get_fb_config(bot)

    if not fb_config.get("enabled"):
        raise HTTPException(status_code=403, detail="此 Bot 尚未啟用 FB 整合")

    # 解密 PAGE_ACCESS_TOKEN
    try:
        page_access_token = decrypt_api_key(fb_config["page_access_token"])
    except (KeyError, ValueError) as e:
        logger.error("FB token 解密失敗 (bot_id=%s): %s", bot.id, e)
        return {"status": "ok"}

    # 驗證 FB 請求簽名（需要 app_secret；若未設定則跳過）
    app_secret = fb_config.get("app_secret_encrypted")
    if app_secret:
        try:
            app_secret_plain = decrypt_api_key(app_secret)
            sig = request.headers.get("X-Hub-Signature-256", "")
            if not _verify_fb_signature(body_bytes, sig, app_secret_plain):
                logger.warning("FB webhook 簽名驗證失敗 (bot_id=%s)", bot.id)
                return {"status": "ok"}
        except ValueError:
            pass

    # 處理訊息事件
    for entry in body.get("entry", []):
        for event in entry.get("messaging", []):
            sender_id = event["sender"]["id"]

            # Postback（FAQ 按鈕點擊）
            postback_payload = event.get("postback", {}).get("payload", "")
            if postback_payload.startswith("FAQ_"):
                faq_id_str = postback_payload.split("_", 1)[1]
                from app.models.bot import BotFaq
                faq = db.query(BotFaq).filter_by(id=int(faq_id_str), bot_id=bot.id).first()
                if faq:
                    await _send_fb_message(sender_id, faq.answer, page_access_token)
                continue

            # 文字訊息（跳過 echo：粉專自己發出的訊息）
            msg = event.get("message", {})
            if msg.get("is_echo"):
                continue
            text = msg.get("text", "").strip()
            if not text:
                continue

            # upsert 外部使用者（新用戶才查 FB 名字）
            existing = db.query(BotExternalUser).filter_by(
                bot_id=bot.id, external_platform="fb", external_user_id=sender_id,
            ).first()
            display_name = existing.display_name if existing else None
            if not existing:
                display_name = await _fetch_fb_display_name(sender_id, page_access_token)

            ext_user = _upsert_external_user(
                db,
                tenant_id=bot.tenant_id,
                bot_id=bot.id,
                external_platform="fb",
                external_user_id=sender_id,
                display_name=display_name,
            )

            # 取對話歷史
            history = _get_conversation_history(db, ext_user)

            # 呼叫 RAG
            answer = await _call_bot_rag(bot, text, history, db)

            # 儲存訊息
            _save_messages(db, ext_user, text, answer)
            db.commit()

            # 回傳給 FB
            await _send_fb_message(sender_id, answer, page_access_token)

    return {"status": "ok"}
