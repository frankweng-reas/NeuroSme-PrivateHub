"""Bot API：Knowledge Bot Agent 的 Bot CRUD + token 管理"""
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
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
    answer_mode: str = "rag"

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
    created_at: str

    model_config = {"from_attributes": True}


def _to_response(bot: Bot, db: Session) -> BotResponse:
    kb_rows = (
        db.query(BotKnowledgeBase, KmKnowledgeBase.name, KmKnowledgeBase.answer_mode)
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
            answer_mode=row.answer_mode or "rag",
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
        created_at=bot.created_at.isoformat() if bot.created_at else "",
    )


def _can_manage(role: str) -> bool:
    return role in ("admin", "super_admin", "manager")


def _is_admin(role: str) -> bool:
    return role in ("admin", "super_admin")


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
    bots = (
        db.query(Bot)
        .filter(Bot.tenant_id == current.tenant_id)
        .order_by(Bot.created_at.asc())
        .all()
    )
    return [_to_response(b, db) for b in bots]


@router.get("/{bot_id}", response_model=BotResponse)
def get_bot(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    bot = db.query(Bot).filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id).first()
    if not bot:
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
    if not bot:
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
    if not bot:
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
    if not bot:
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
    if not bot:
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
