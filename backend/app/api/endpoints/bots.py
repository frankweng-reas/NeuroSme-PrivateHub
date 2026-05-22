"""Bot API：Knowledge Bot Agent 的 Bot CRUD + token 管理"""
import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.encryption import decrypt_api_key, encrypt_api_key, mask_api_key
from app.core.security import get_current_user
from app.models.bot import Bot, BotFaq, BotKnowledgeBase
from app.models.km_knowledge_base import KmKnowledgeBase
from app.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────


class BotKbItem(BaseModel):
    knowledge_base_id: int
    sort_order: int = 0


class BotCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    system_prompt: str | None = None
    fallback_message: str | None = None
    fallback_message_enabled: bool = False
    answer_mode: str = "rag"
    model_name: str | None = None
    knowledge_base_ids: list[BotKbItem] = []


class BotUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    is_active: bool | None = None
    system_prompt: str | None = None
    fallback_message: str | None = None
    fallback_message_enabled: bool | None = None
    answer_mode: str | None = None
    model_name: str | None = None
    knowledge_base_ids: list[BotKbItem] | None = None
    widget_title: str | None = None
    widget_logo_url: str | None = None
    widget_color: str | None = None
    widget_lang: str | None = None
    widget_voice_enabled: bool | None = None
    widget_voice_prompt: str | None = None
    # 客服情境
    home_enabled: bool | None = None
    home_greeting: str | None = None
    home_quick_questions: str | None = None  # JSON string（保留欄位，暫不顯示）
    popular_faq_enabled: bool | None = None
    common_faq_enabled: bool | None = None
    contact_enabled: bool | None = None
    contact_links: str | None = None         # JSON string
    access_mode: str | None = None           # 'public' | 'authenticated'


class BotKbResponse(BaseModel):
    knowledge_base_id: int
    name: str
    sort_order: int

    model_config = {"from_attributes": True}


class BotFaqResponse(BaseModel):
    id: int
    question: str
    answer: str
    sort_order: int
    is_active: bool
    faq_type: str

    model_config = {"from_attributes": True}


class BotResponse(BaseModel):
    id: int
    name: str
    description: str | None
    is_active: bool
    system_prompt: str | None
    fallback_message: str | None
    fallback_message_enabled: bool
    answer_mode: str
    model_name: str | None
    public_token: str | None
    widget_title: str | None
    widget_logo_url: str | None
    widget_color: str | None
    widget_lang: str | None
    widget_voice_enabled: bool
    widget_voice_prompt: str | None
    home_enabled: bool
    home_greeting: str | None
    home_quick_questions: str | None
    popular_faq_enabled: bool
    common_faq_enabled: bool
    contact_enabled: bool
    contact_links: str | None
    access_mode: str
    knowledge_bases: list[BotKbResponse]
    created_by: int | None
    created_at: str

    model_config = {"from_attributes": True}


def _to_response(bot: Bot, db: Session) -> BotResponse:
    kb_rows = (
        db.query(BotKnowledgeBase, KmKnowledgeBase.name)
        .join(KmKnowledgeBase, BotKnowledgeBase.knowledge_base_id == KmKnowledgeBase.id)
        .filter(BotKnowledgeBase.bot_id == bot.id)
        .order_by(BotKnowledgeBase.sort_order)
        .all()
    )
    kbs = [
        BotKbResponse(
            knowledge_base_id=row.BotKnowledgeBase.knowledge_base_id,
            name=row.name,
            sort_order=row.BotKnowledgeBase.sort_order,
        )
        for row in kb_rows
    ]
    return BotResponse(
        id=bot.id,
        name=bot.name,
        description=bot.description,
        is_active=bot.is_active,
        system_prompt=bot.system_prompt,
        fallback_message=bot.fallback_message,
        fallback_message_enabled=bot.fallback_message_enabled or False,
        answer_mode=bot.answer_mode or "rag",
        model_name=bot.model_name,
        public_token=bot.public_token,
        widget_title=bot.widget_title,
        widget_logo_url=bot.widget_logo_url,
        widget_color=bot.widget_color,
        widget_lang=bot.widget_lang,
        widget_voice_enabled=bot.widget_voice_enabled or False,
        widget_voice_prompt=bot.widget_voice_prompt,
        home_enabled=bot.home_enabled or False,
        home_greeting=bot.home_greeting,
        home_quick_questions=bot.home_quick_questions,
        popular_faq_enabled=bot.popular_faq_enabled or False,
        common_faq_enabled=bot.common_faq_enabled or False,
        contact_enabled=bot.contact_enabled or False,
        contact_links=bot.contact_links,
        access_mode=bot.access_mode or "public",
        knowledge_bases=kbs,
        created_by=bot.created_by,
        created_at=bot.created_at.isoformat() if bot.created_at else "",
    )


def _can_manage(role: str) -> bool:
    return role in ("admin", "super_admin", "manager")


def _is_admin(role: str) -> bool:
    return role in ("admin", "super_admin")


def _is_bot_owner_or_admin(bot: Bot, current: User) -> bool:
    return current.role in ("admin", "super_admin") or bot.created_by == current.id


def _sync_kb_relations(bot_id: int, kb_items: list[BotKbItem], db: Session) -> None:
    db.query(BotKnowledgeBase).filter(BotKnowledgeBase.bot_id == bot_id).delete()
    for item in kb_items:
        db.add(BotKnowledgeBase(
            bot_id=bot_id,
            knowledge_base_id=item.knowledge_base_id,
            sort_order=item.sort_order,
        ))


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.post("", response_model=BotResponse, status_code=201)
def create_bot(
    body: BotCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):

    existing = db.query(Bot).filter(
        Bot.tenant_id == current.tenant_id,
        Bot.name == body.name.strip(),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Bot「{body.name}」已存在")

    bot = Bot(
        tenant_id=current.tenant_id,
        name=body.name.strip(),
        description=body.description,
        system_prompt=body.system_prompt or None,
        fallback_message=body.fallback_message or None,
        fallback_message_enabled=body.fallback_message_enabled,
        answer_mode=body.answer_mode or "rag",
        model_name=body.model_name or None,
        created_by=current.id,
    )
    db.add(bot)
    db.flush()
    _sync_kb_relations(bot.id, body.knowledge_base_ids, db)
    db.commit()
    db.refresh(bot)
    return _to_response(bot, db)


@router.get("", response_model=list[BotResponse])
def list_bots(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    q = db.query(Bot).filter(Bot.tenant_id == current.tenant_id)
    # 非 admin 只能看到自己建立的 Bot
    if not _is_admin(current.role):
        q = q.filter(Bot.created_by == current.id)
    bots = q.order_by(Bot.created_at.asc()).all()
    return [_to_response(b, db) for b in bots]


@router.get("/{bot_id}", response_model=BotResponse)
def get_bot(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot or not _is_bot_owner_or_admin(bot, current):
        raise HTTPException(status_code=404, detail="Bot 不存在")
    return _to_response(bot, db)


@router.patch("/{bot_id}", response_model=BotResponse)
def update_bot(
    bot_id: int,
    body: BotUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot or not _is_bot_owner_or_admin(bot, current):
        raise HTTPException(status_code=404, detail="Bot 不存在")

    if body.name is not None:
        bot.name = body.name.strip()
    if body.description is not None:
        bot.description = body.description
    if body.is_active is not None:
        bot.is_active = body.is_active
    if body.system_prompt is not None:
        bot.system_prompt = body.system_prompt or None
    if body.fallback_message is not None:
        bot.fallback_message = body.fallback_message or None
    if body.fallback_message_enabled is not None:
        bot.fallback_message_enabled = body.fallback_message_enabled
    if body.answer_mode is not None:
        bot.answer_mode = body.answer_mode or "rag"
    if body.model_name is not None:
        bot.model_name = body.model_name or None
    if body.widget_title is not None:
        bot.widget_title = body.widget_title or None
    if body.widget_logo_url is not None:
        bot.widget_logo_url = body.widget_logo_url or None
    if body.widget_color is not None:
        bot.widget_color = body.widget_color or None
    if body.widget_lang is not None:
        bot.widget_lang = body.widget_lang or None
    if body.widget_voice_enabled is not None:
        bot.widget_voice_enabled = body.widget_voice_enabled
    if body.widget_voice_prompt is not None:
        bot.widget_voice_prompt = body.widget_voice_prompt or None
    if body.knowledge_base_ids is not None:
        _sync_kb_relations(bot.id, body.knowledge_base_ids, db)
    if body.home_enabled is not None:
        bot.home_enabled = body.home_enabled
    if body.home_greeting is not None:
        bot.home_greeting = body.home_greeting or None
    if body.home_quick_questions is not None:
        bot.home_quick_questions = body.home_quick_questions or None
    if body.popular_faq_enabled is not None:
        bot.popular_faq_enabled = body.popular_faq_enabled
    if body.common_faq_enabled is not None:
        bot.common_faq_enabled = body.common_faq_enabled
    if body.contact_enabled is not None:
        bot.contact_enabled = body.contact_enabled
    if body.contact_links is not None:
        bot.contact_links = body.contact_links or None
    if body.access_mode is not None and body.access_mode in ("public", "authenticated"):
        bot.access_mode = body.access_mode

    db.commit()
    db.refresh(bot)
    return _to_response(bot, db)


@router.delete("/{bot_id}", status_code=204)
def delete_bot(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot or not _is_bot_owner_or_admin(bot, current):
        raise HTTPException(status_code=404, detail="Bot 不存在")

    db.delete(bot)
    db.commit()


@router.post("/{bot_id}/generate-token", response_model=BotResponse)
def generate_bot_token(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """產生（或重設）Bot Widget public_token，僅限 admin / super_admin"""
    if not _is_admin(current.role):
        raise HTTPException(status_code=403, detail="只有系統管理員可以開通 Widget Token")

    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot 不存在")

    bot.public_token = uuid.uuid4().hex
    db.commit()
    db.refresh(bot)
    return _to_response(bot, db)


@router.delete("/{bot_id}/token", response_model=BotResponse)
def revoke_bot_token(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """停用 Bot Widget：清空 public_token，僅限 admin / super_admin"""
    if not _is_admin(current.role):
        raise HTTPException(status_code=403, detail="只有系統管理員可以停用 Widget Token")

    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot 不存在")

    bot.public_token = None
    db.commit()
    db.refresh(bot)
    return _to_response(bot, db)


# ──────────────────────────────────────────────────────────────────────────────
# Bot Query Stats
# ──────────────────────────────────────────────────────────────────────────────

class BotQueryStatsSummary(BaseModel):
    total_queries: int
    hit_count: int
    zero_hit_count: int
    hit_rate: float


class BotQueryItem(BaseModel):
    query: str
    count: int
    hit: bool
    last_asked_at: str


class BotQueryStatsResponse(BaseModel):
    summary: BotQueryStatsSummary
    queries: list[BotQueryItem]
    total: int
    offset: int


BotQueryStatsView = str  # 'top_queries' | 'zero_hit'


@router.get("/{bot_id}/query-stats", response_model=BotQueryStatsResponse)
def get_bot_query_stats(
    bot_id: int,
    days: int = 30,
    view: BotQueryStatsView = "top_queries",
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得 Bot 查詢統計：摘要 + 查詢清單（top_queries / zero_hit）"""
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import func as sqlfunc, text as sqtext

    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot or not _is_bot_owner_or_admin(bot, current):
        raise HTTPException(status_code=404, detail="Bot 不存在")

    from app.models.bot_query_log import BotQueryLog

    since = datetime.now(timezone.utc) - timedelta(days=days)
    base_q = db.query(BotQueryLog).filter(
        BotQueryLog.bot_id == bot_id,
        BotQueryLog.created_at >= since,
    )

    total_queries = base_q.count()
    hit_count = base_q.filter(BotQueryLog.hit == True).count()  # noqa: E712
    zero_hit_count = total_queries - hit_count
    hit_rate = hit_count / total_queries if total_queries > 0 else 0.0

    summary = BotQueryStatsSummary(
        total_queries=total_queries,
        hit_count=hit_count,
        zero_hit_count=zero_hit_count,
        hit_rate=hit_rate,
    )

    # 查詢清單：依 query 分組，計次數
    hit_filter = True if view == "top_queries" else False  # noqa: E712
    rows = (
        db.query(
            BotQueryLog.query,
            sqlfunc.count(BotQueryLog.id).label("cnt"),
            sqlfunc.bool_and(BotQueryLog.hit).label("hit"),
            sqlfunc.max(BotQueryLog.created_at).label("last_at"),
        )
        .filter(
            BotQueryLog.bot_id == bot_id,
            BotQueryLog.created_at >= since,
            BotQueryLog.hit == hit_filter,
        )
        .group_by(BotQueryLog.query)
        .order_by(sqlfunc.count(BotQueryLog.id).desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    count_q = (
        db.query(sqlfunc.count(sqlfunc.distinct(BotQueryLog.query)))
        .filter(
            BotQueryLog.bot_id == bot_id,
            BotQueryLog.created_at >= since,
            BotQueryLog.hit == hit_filter,
        )
        .scalar()
    ) or 0

    queries = [
        BotQueryItem(
            query=r.query,
            count=r.cnt,
            hit=bool(r.hit),
            last_asked_at=r.last_at.isoformat() if r.last_at else "",
        )
        for r in rows
    ]

    return BotQueryStatsResponse(
        summary=summary,
        queries=queries,
        total=count_q,
        offset=offset,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Bot FAQ CRUD
# ──────────────────────────────────────────────────────────────────────────────


FAQ_TYPES = ("popular", "common")


class FaqCreate(BaseModel):
    question: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)
    sort_order: int = 0
    faq_type: str = "common"  # 'popular' | 'common'


class FaqUpdate(BaseModel):
    question: str | None = Field(None, min_length=1)
    answer: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    faq_type: str | None = None  # 'popular' | 'common'


class FaqReorderItem(BaseModel):
    id: int
    sort_order: int


def _get_bot_for_manage(bot_id: int, current: User, db: Session) -> Bot:
    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot or not _is_bot_owner_or_admin(bot, current):
        raise HTTPException(status_code=404, detail="Bot 不存在")
    return bot


@router.get("/{bot_id}/faqs", response_model=list[BotFaqResponse])
def list_faqs(
    bot_id: int,
    faq_type: str | None = None,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出 FAQ；可傳 ?faq_type=popular 或 ?faq_type=common 篩選"""
    _get_bot_for_manage(bot_id, current, db)
    q = db.query(BotFaq).filter(BotFaq.bot_id == bot_id)
    if faq_type and faq_type in FAQ_TYPES:
        q = q.filter(BotFaq.faq_type == faq_type)
    rows = q.order_by(BotFaq.sort_order, BotFaq.id).all()
    return [BotFaqResponse.model_validate(r) for r in rows]


@router.post("/{bot_id}/faqs", response_model=BotFaqResponse, status_code=201)
def create_faq(
    bot_id: int,
    body: FaqCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    _get_bot_for_manage(bot_id, current, db)
    faq_type = body.faq_type if body.faq_type in FAQ_TYPES else "common"
    faq = BotFaq(
        bot_id=bot_id,
        question=body.question.strip(),
        answer=body.answer.strip(),
        sort_order=body.sort_order,
        faq_type=faq_type,
    )
    db.add(faq)
    db.commit()
    db.refresh(faq)
    return BotFaqResponse.model_validate(faq)


@router.patch("/{bot_id}/faqs/{faq_id}", response_model=BotFaqResponse)
def update_faq(
    bot_id: int,
    faq_id: int,
    body: FaqUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    _get_bot_for_manage(bot_id, current, db)
    faq = db.query(BotFaq).filter(BotFaq.id == faq_id, BotFaq.bot_id == bot_id).first()
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ 不存在")
    if body.question is not None:
        faq.question = body.question.strip()
    if body.answer is not None:
        faq.answer = body.answer.strip()
    if body.sort_order is not None:
        faq.sort_order = body.sort_order
    if body.is_active is not None:
        faq.is_active = body.is_active
    if body.faq_type is not None and body.faq_type in FAQ_TYPES:
        faq.faq_type = body.faq_type
    db.commit()
    db.refresh(faq)
    return BotFaqResponse.model_validate(faq)


@router.delete("/{bot_id}/faqs/{faq_id}", status_code=204)
def delete_faq(
    bot_id: int,
    faq_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    _get_bot_for_manage(bot_id, current, db)
    faq = db.query(BotFaq).filter(BotFaq.id == faq_id, BotFaq.bot_id == bot_id).first()
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ 不存在")
    db.delete(faq)
    db.commit()


@router.post("/{bot_id}/faqs/reorder", status_code=204)
def reorder_faqs(
    bot_id: int,
    body: list[FaqReorderItem],
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    _get_bot_for_manage(bot_id, current, db)
    for item in body:
        db.query(BotFaq).filter(BotFaq.id == item.id, BotFaq.bot_id == bot_id).update(
            {"sort_order": item.sort_order}
        )
    db.commit()


# ──────────────────────────────────────────────────────────────────────────────
# FB Messenger 整合
# ──────────────────────────────────────────────────────────────────────────────


class FbIntegrationSaveRequest(BaseModel):
    page_access_token: str = Field(..., min_length=10, description="FB 粉專 Page Access Token")


class FbIntegrationResponse(BaseModel):
    enabled: bool
    webhook_url: str
    verify_token: str
    page_access_token_masked: str | None = None
    connected_at: str | None = None


@router.put(
    "/{bot_id}/messaging/fb",
    response_model=FbIntegrationResponse,
    summary="儲存 FB Messenger 整合設定",
)
def save_fb_integration(
    bot_id: int,
    body: FbIntegrationSaveRequest,
    request: Request,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """儲存（或更新）FB Messenger 整合：加密存放 page_access_token，產生 verify_token。"""
    bot = _get_bot_for_manage(bot_id, current, db)

    if not bot.public_token:
        raise HTTPException(status_code=400, detail="此 Bot 尚未開通 Widget Token，請先產生 public token")

    integrations: dict = dict(bot.messaging_integrations or {})
    existing_fb = integrations.get("fb", {})

    # 保留既有 verify_token，首次設定才產生新的
    verify_token = existing_fb.get("verify_token") or f"nsm_{secrets.token_urlsafe(16)}"

    integrations["fb"] = {
        "enabled": True,
        "page_access_token": encrypt_api_key(body.page_access_token),
        "verify_token": verify_token,
        "connected_at": datetime.now(timezone.utc).isoformat(),
    }
    bot.messaging_integrations = integrations
    db.commit()

    base_url = (settings.SERVER_BASE_URL or str(request.base_url)).rstrip("/")
    webhook_url = f"{base_url}/api/v1/webhook/fb/{bot.public_token}"

    return FbIntegrationResponse(
        enabled=True,
        webhook_url=webhook_url,
        verify_token=verify_token,
        page_access_token_masked=mask_api_key(body.page_access_token),
        connected_at=integrations["fb"]["connected_at"],
    )


@router.get(
    "/{bot_id}/messaging/fb",
    response_model=FbIntegrationResponse,
    summary="取得 FB Messenger 整合狀態",
)
def get_fb_integration(
    bot_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得 FB 整合設定（token 僅回傳遮罩版本）。

    無論是否已設定 PAGE_ACCESS_TOKEN，都會立即回傳 webhook_url 與 verify_token，
    讓客戶可以先把這兩個值填回 FB Developer Console。
    """
    bot = _get_bot_for_manage(bot_id, current, db)
    integrations: dict = dict(bot.messaging_integrations or {})
    fb: dict = dict(integrations.get("fb", {}))

    base_url = (settings.SERVER_BASE_URL or str(request.base_url)).rstrip("/")
    webhook_url = f"{base_url}/api/v1/webhook/fb/{bot.public_token}" if bot.public_token else ""

    # 首次查詢：自動產生並儲存 verify_token（不需要等 PAGE_ACCESS_TOKEN）
    if bot.public_token and not fb.get("verify_token"):
        fb["verify_token"] = f"nsm_{secrets.token_urlsafe(16)}"
        fb.setdefault("enabled", False)
        integrations["fb"] = fb
        bot.messaging_integrations = integrations
        db.commit()

    verify_token = fb.get("verify_token", "")

    if not fb.get("enabled"):
        return FbIntegrationResponse(
            enabled=False,
            webhook_url=webhook_url,
            verify_token=verify_token,
        )

    try:
        plain_token = decrypt_api_key(fb["page_access_token"])
        masked = mask_api_key(plain_token)
    except Exception:
        masked = "（解密失敗）"

    return FbIntegrationResponse(
        enabled=True,
        webhook_url=webhook_url,
        verify_token=verify_token,
        page_access_token_masked=masked,
        connected_at=fb.get("connected_at"),
    )


@router.delete(
    "/{bot_id}/messaging/fb",
    status_code=204,
    summary="移除 FB Messenger 整合",
)
def delete_fb_integration(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """移除 FB 整合設定（清空 fb key）。"""
    bot = _get_bot_for_manage(bot_id, current, db)
    integrations: dict = dict(bot.messaging_integrations or {})
    integrations.pop("fb", None)
    bot.messaging_integrations = integrations
    db.commit()
