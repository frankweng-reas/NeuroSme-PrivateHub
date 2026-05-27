"""Widget 管理 API：供登入用戶查看 Bot 訪客 session 與對話紀錄"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.bot import Bot
from app.models.bot_external_user import BotExternalUser
from app.models.bot_widget_session import BotWidgetMessage, BotWidgetSession
from app.models.user import User

router = APIRouter()

ConversationFilter = Literal["all", "widget", "fb", "line", "external"]

_CHANNEL_LABELS: dict[str, str] = {
    "widget": "Widget",
    "fb": "FB",
    "line": "LINE",
    "custom": "自訂",
    "localauth": "LocalAuth",
}


# ── Schemas ────────────────────────────────────────────────────────────────────


class WidgetSessionItem(BaseModel):
    session_id: str
    visitor_name: str | None
    visitor_email: str | None
    visitor_phone: str | None
    message_count: int
    created_at: str
    last_active_at: str

    model_config = {"from_attributes": True}


class WidgetMessageItem(BaseModel):
    id: int
    role: str
    content: str
    created_at: str

    model_config = {"from_attributes": True}


class WidgetSessionDetail(WidgetSessionItem):
    messages: list[WidgetMessageItem]


class ConversationThreadItem(BaseModel):
    """統一訪客對話列表項（Widget + 外部平台）。"""

    thread_key: str
    channel: str
    channel_label: str
    title: str
    subtitle: str | None
    message_count: int
    created_at: str
    last_active_at: str
    visitor_email: str | None = None
    visitor_phone: str | None = None
    external_user_id: str | None = None


class ConversationThreadDetail(ConversationThreadItem):
    messages: list[WidgetMessageItem]


# ── Helpers ────────────────────────────────────────────────────────────────────


def _get_bot_for_user(bot_id: int, current: User, db: Session) -> Bot:
    bot = (
        db.query(Bot)
        .filter(Bot.id == bot_id, Bot.tenant_id == current.tenant_id)
        .first()
    )
    if not bot:
        raise HTTPException(status_code=404, detail="Bot 不存在")
    return bot


def _parse_thread_key(thread_key: str) -> tuple[str, str]:
    if ":" not in thread_key:
        raise HTTPException(status_code=400, detail="thread_key 格式錯誤")
    channel, thread_id = thread_key.split(":", 1)
    if channel not in ("widget", "fb", "line", "custom", "localauth"):
        raise HTTPException(status_code=400, detail="不支援的 channel")
    if not thread_id:
        raise HTTPException(status_code=400, detail="thread_key 格式錯誤")
    return channel, thread_id


def _widget_session_items(bot_id: int, db: Session) -> list[ConversationThreadItem]:
    sessions = (
        db.query(BotWidgetSession)
        .filter(BotWidgetSession.bot_id == bot_id)
        .order_by(BotWidgetSession.last_active_at.desc())
        .all()
    )
    items: list[ConversationThreadItem] = []
    for s in sessions:
        count = db.query(BotWidgetMessage).filter(BotWidgetMessage.session_id == s.id).count()
        items.append(
            ConversationThreadItem(
                thread_key=f"widget:{s.id}",
                channel="widget",
                channel_label=_CHANNEL_LABELS["widget"],
                title=s.visitor_name or "匿名訪客",
                subtitle=s.visitor_email or s.visitor_phone,
                message_count=count,
                created_at=s.created_at.isoformat(),
                last_active_at=s.last_active_at.isoformat(),
                visitor_email=s.visitor_email,
                visitor_phone=s.visitor_phone,
            )
        )
    return items


def _external_user_items(
    bot_id: int,
    db: Session,
    *,
    platform: str | None = None,
) -> list[ConversationThreadItem]:
    q = db.query(BotExternalUser).filter(BotExternalUser.bot_id == bot_id)
    if platform:
        q = q.filter(BotExternalUser.external_platform == platform)
    else:
        q = q.filter(BotExternalUser.external_platform != "localauth")
    users = q.order_by(BotExternalUser.last_seen_at.desc()).all()

    items: list[ConversationThreadItem] = []
    for u in users:
        count = (
            db.query(BotWidgetMessage)
            .filter(BotWidgetMessage.external_user_fk == u.id)
            .count()
        )
        platform = u.external_platform
        title = u.display_name or f"{_CHANNEL_LABELS.get(platform, platform)} 使用者"
        items.append(
            ConversationThreadItem(
                thread_key=f"{platform}:{u.id}",
                channel=platform,
                channel_label=_CHANNEL_LABELS.get(platform, platform),
                title=title,
                subtitle=f"{_CHANNEL_LABELS.get(platform, platform)} · …{u.external_user_id[-4:]}",
                message_count=count,
                created_at=u.first_seen_at.isoformat(),
                last_active_at=u.last_seen_at.isoformat(),
                external_user_id=u.external_user_id,
            )
        )
    return items


# ── Endpoints ──────────────────────────────────────────────────────────────────


@router.get("/bot/{bot_id}/conversations", response_model=list[ConversationThreadItem])
def list_bot_conversations(
    bot_id: int,
    channel: ConversationFilter = Query(default="all"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出 Bot 的所有訪客對話（Widget + 外部平台），可依 channel 篩選。"""
    _get_bot_for_user(bot_id, current, db)

    items: list[ConversationThreadItem] = []
    if channel in ("all", "widget"):
        items.extend(_widget_session_items(bot_id, db))
    if channel == "all":
        items.extend(_external_user_items(bot_id, db))
    elif channel == "external":
        items.extend(_external_user_items(bot_id, db))
    elif channel in ("fb", "line"):
        items.extend(_external_user_items(bot_id, db, platform=channel))

    items.sort(key=lambda x: x.last_active_at, reverse=True)
    return items


@router.get("/conversations/detail", response_model=ConversationThreadDetail)
def get_conversation_detail(
    thread_key: str = Query(..., description="格式：widget:{session_id} 或 fb:{uuid}"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得單一訪客對話的完整紀錄（Widget 或外部平台）。"""
    channel, thread_id = _parse_thread_key(thread_key)

    if channel == "widget":
        session = db.query(BotWidgetSession).filter(BotWidgetSession.id == thread_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Session 不存在")
        _get_bot_for_user(session.bot_id, current, db)

        messages = (
            db.query(BotWidgetMessage)
            .filter(BotWidgetMessage.session_id == thread_id)
            .order_by(BotWidgetMessage.created_at)
            .all()
        )
        return ConversationThreadDetail(
            thread_key=thread_key,
            channel="widget",
            channel_label=_CHANNEL_LABELS["widget"],
            title=session.visitor_name or "匿名訪客",
            subtitle=session.visitor_email or session.visitor_phone,
            message_count=len(messages),
            created_at=session.created_at.isoformat(),
            last_active_at=session.last_active_at.isoformat(),
            visitor_email=session.visitor_email,
            visitor_phone=session.visitor_phone,
            messages=[
                WidgetMessageItem(
                    id=m.id,
                    role=m.role,
                    content=m.content,
                    created_at=m.created_at.isoformat(),
                )
                for m in messages
            ],
        )

    ext_user = db.query(BotExternalUser).filter(BotExternalUser.id == thread_id).first()
    if not ext_user or ext_user.external_platform != channel:
        raise HTTPException(status_code=404, detail="外部使用者不存在")
    _get_bot_for_user(ext_user.bot_id, current, db)

    messages = (
        db.query(BotWidgetMessage)
        .filter(BotWidgetMessage.external_user_fk == ext_user.id)
        .order_by(BotWidgetMessage.created_at)
        .all()
    )
    platform = ext_user.external_platform
    title = ext_user.display_name or f"{_CHANNEL_LABELS.get(platform, platform)} 使用者"
    return ConversationThreadDetail(
        thread_key=thread_key,
        channel=platform,
        channel_label=_CHANNEL_LABELS.get(platform, platform),
        title=title,
        subtitle=f"{_CHANNEL_LABELS.get(platform, platform)} · …{ext_user.external_user_id[-4:]}",
        message_count=len(messages),
        created_at=ext_user.first_seen_at.isoformat(),
        last_active_at=ext_user.last_seen_at.isoformat(),
        external_user_id=ext_user.external_user_id,
        messages=[
            WidgetMessageItem(
                id=m.id,
                role=m.role,
                content=m.content,
                created_at=m.created_at.isoformat(),
            )
            for m in messages
        ],
    )


@router.get("/bot/{bot_id}/sessions", response_model=list[WidgetSessionItem])
def list_bot_widget_sessions(
    bot_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """列出指定 Bot 的所有 Widget 訪客 Session（含訊息筆數）"""
    _get_bot_for_user(bot_id, current, db)

    sessions = (
        db.query(BotWidgetSession)
        .filter(BotWidgetSession.bot_id == bot_id)
        .order_by(BotWidgetSession.last_active_at.desc())
        .all()
    )

    result = []
    for s in sessions:
        count = db.query(BotWidgetMessage).filter(BotWidgetMessage.session_id == s.id).count()
        result.append(
            WidgetSessionItem(
                session_id=s.id,
                visitor_name=s.visitor_name,
                visitor_email=s.visitor_email,
                visitor_phone=s.visitor_phone,
                message_count=count,
                created_at=s.created_at.isoformat(),
                last_active_at=s.last_active_at.isoformat(),
            )
        )
    return result


@router.get("/bot-sessions/{session_id}/messages", response_model=WidgetSessionDetail)
def get_bot_widget_session_messages(
    session_id: str,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得單一 Bot Widget Session 的完整對話紀錄"""
    session = db.query(BotWidgetSession).filter(BotWidgetSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session 不存在")

    _get_bot_for_user(session.bot_id, current, db)

    messages = (
        db.query(BotWidgetMessage)
        .filter(BotWidgetMessage.session_id == session_id)
        .order_by(BotWidgetMessage.created_at)
        .all()
    )

    return WidgetSessionDetail(
        session_id=session.id,
        visitor_name=session.visitor_name,
        visitor_email=session.visitor_email,
        visitor_phone=session.visitor_phone,
        message_count=len(messages),
        created_at=session.created_at.isoformat(),
        last_active_at=session.last_active_at.isoformat(),
        messages=[
            WidgetMessageItem(
                id=m.id,
                role=m.role,
                content=m.content,
                created_at=m.created_at.isoformat(),
            )
            for m in messages
        ],
    )
