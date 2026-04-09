"""Chat LLM 用量洞察：租戶級聚合（admin / super_admin），資料源 chat_llm_requests"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import Date, case, cast, func, literal
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.chat_llm_request import ChatLlmRequest
from app.models.chat_message import ChatMessage
from app.models.chat_message_attachment import ChatMessageAttachment
from app.models.chat_thread import ChatThread
from app.models.stored_file import StoredFile
from app.models.user import User

router = APIRouter()

MAX_RANGE_DAYS = 400

TZ_TAIPEI = ZoneInfo("Asia/Taipei")


def _require_admin_insights(user: User) -> None:
    if str(getattr(user, "role", "")) not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="需 admin 或 super_admin 權限")


@dataclass(frozen=True)
class TaipeiDateRangeUtc:
    """API 之 start/end 為台北日曆日；實際查詢為 [start_utc, end_utc_exclusive)（UTC）。"""

    start_date: date
    end_date: date
    start_utc: datetime
    end_utc_exclusive: datetime


def _parse_taipei_calendar_range(start: date | None, end: date | None) -> TaipeiDateRangeUtc:
    today_taipei = datetime.now(TZ_TAIPEI).date()
    end_d = end or today_taipei
    start_d = start or (end_d - timedelta(days=29))
    if start_d > end_d:
        raise HTTPException(status_code=400, detail="start 不可晚於 end")
    if (end_d - start_d).days > MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"查詢區間不可超過 {MAX_RANGE_DAYS} 天",
        )
    start_utc = datetime.combine(start_d, time(0, 0, 0), tzinfo=TZ_TAIPEI).astimezone(timezone.utc)
    end_utc_exclusive = datetime.combine(
        end_d + timedelta(days=1),
        time(0, 0, 0),
        tzinfo=TZ_TAIPEI,
    ).astimezone(timezone.utc)
    return TaipeiDateRangeUtc(
        start_date=start_d,
        end_date=end_d,
        start_utc=start_utc,
        end_utc_exclusive=end_utc_exclusive,
    )


def _taipei_started_at_date():
    """PostgreSQL：timestamptz → 台北日曆日期（與 group_by 須同一表达式）。"""
    return cast(func.timezone(literal("Asia/Taipei"), ChatLlmRequest.started_at), Date)


class ChatInsightsSummaryBlock(BaseModel):
    request_count: int
    success_count: int
    error_count: int
    pending_count: int
    total_prompt_tokens: int
    total_completion_tokens: int
    total_tokens: int
    avg_total_tokens_per_request: float | None = Field(
        None,
        description="以有回報 total_tokens 的列加總除以請求總數；均無則 null",
    )


class ChatInsightsByModelRow(BaseModel):
    llm_model: str | None = Field(None, description="LiteLLM／前端模型名")
    provider: str | None
    request_count: int
    success_count: int
    error_count: int
    total_prompt_tokens: int
    total_completion_tokens: int
    total_tokens: int


class ChatInsightsByStatusRow(BaseModel):
    status: str
    count: int


class ChatInsightsErrorCodeRow(BaseModel):
    error_code: str
    count: int


class ChatInsightsDailyRow(BaseModel):
    day: date
    request_count: int
    success_count: int
    error_count: int
    total_tokens: int


class ChatInsightsOverviewResponse(BaseModel):
    tenant_id: str
    start: date
    end: date
    summary: ChatInsightsSummaryBlock
    by_model: list[ChatInsightsByModelRow]
    by_status: list[ChatInsightsByStatusRow]
    top_error_codes: list[ChatInsightsErrorCodeRow]
    by_day: list[ChatInsightsDailyRow]


@router.get("/overview", response_model=ChatInsightsOverviewResponse)
def chat_insights_overview(
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    start: Annotated[date | None, Query(description="起日（台北日曆日），預設 end 往前 29 天")] = None,
    end: Annotated[date | None, Query(description="迄日（台北日曆日），預設台北「今天」")] = None,
) -> ChatInsightsOverviewResponse:
    """
    A-1／A-2／A-3：租戶內 Chat LLM 請求量、token、依模型與狀態、錯誤碼 Top。
    僅 admin / super_admin；資料僅含 current_user.tenant_id。
    日期區間以 Asia/Taipei 解讀；DB 仍為 UTC timestamptz。
    """
    _require_admin_insights(current)
    tr = _parse_taipei_calendar_range(start, end)
    tenant_id = current.tenant_id

    base_filter = (
        ChatLlmRequest.tenant_id == tenant_id,
        ChatLlmRequest.started_at >= tr.start_utc,
        ChatLlmRequest.started_at < tr.end_utc_exclusive,
    )

    sum_prompt = func.coalesce(func.sum(ChatLlmRequest.prompt_tokens), 0)
    sum_comp = func.coalesce(func.sum(ChatLlmRequest.completion_tokens), 0)
    sum_total = func.coalesce(func.sum(ChatLlmRequest.total_tokens), 0)

    row = (
        db.query(
            func.count().label("request_count"),
            func.sum(case((ChatLlmRequest.status == "success", 1), else_=0)).label("success_count"),
            func.sum(case((ChatLlmRequest.status == "error", 1), else_=0)).label("error_count"),
            func.sum(case((ChatLlmRequest.status == "pending", 1), else_=0)).label("pending_count"),
            sum_prompt.label("total_prompt_tokens"),
            sum_comp.label("total_completion_tokens"),
            sum_total.label("total_tokens"),
        )
        .filter(*base_filter)
        .one()
    )

    req_n = int(row.request_count or 0)
    avg_total: float | None = None
    if req_n > 0:
        avg_total = round((row.total_tokens or 0) / req_n, 4)

    summary = ChatInsightsSummaryBlock(
        request_count=req_n,
        success_count=int(row.success_count or 0),
        error_count=int(row.error_count or 0),
        pending_count=int(row.pending_count or 0),
        total_prompt_tokens=int(row.total_prompt_tokens or 0),
        total_completion_tokens=int(row.total_completion_tokens or 0),
        total_tokens=int(row.total_tokens or 0),
        avg_total_tokens_per_request=avg_total,
    )

    # A-2：依 model + provider
    q_model = (
        db.query(
            ChatLlmRequest.model,
            ChatLlmRequest.provider,
            func.count().label("request_count"),
            func.sum(case((ChatLlmRequest.status == "success", 1), else_=0)).label("success_count"),
            func.sum(case((ChatLlmRequest.status == "error", 1), else_=0)).label("error_count"),
            func.coalesce(func.sum(ChatLlmRequest.prompt_tokens), 0).label("total_prompt_tokens"),
            func.coalesce(func.sum(ChatLlmRequest.completion_tokens), 0).label("total_completion_tokens"),
            func.coalesce(func.sum(ChatLlmRequest.total_tokens), 0).label("total_tokens"),
        )
        .filter(*base_filter)
        .group_by(ChatLlmRequest.model, ChatLlmRequest.provider)
        .order_by(func.count().desc())
    )
    by_model = [
        ChatInsightsByModelRow(
            llm_model=r.model,
            provider=r.provider,
            request_count=int(r.request_count),
            success_count=int(r.success_count or 0),
            error_count=int(r.error_count or 0),
            total_prompt_tokens=int(r.total_prompt_tokens),
            total_completion_tokens=int(r.total_completion_tokens),
            total_tokens=int(r.total_tokens),
        )
        for r in q_model.all()
    ]

    q_status = (
        db.query(ChatLlmRequest.status, func.count())
        .filter(*base_filter)
        .group_by(ChatLlmRequest.status)
        .order_by(func.count().desc())
    )
    by_status = [ChatInsightsByStatusRow(status=s, count=int(c)) for s, c in q_status.all()]

    q_err = (
        db.query(ChatLlmRequest.error_code, func.count())
        .filter(
            *base_filter,
            ChatLlmRequest.status == "error",
            ChatLlmRequest.error_code.isnot(None),
            ChatLlmRequest.error_code != "",
        )
        .group_by(ChatLlmRequest.error_code)
        .order_by(func.count().desc())
        .limit(25)
    )
    top_error_codes = [ChatInsightsErrorCodeRow(error_code=code or "", count=int(c)) for code, c in q_err.all()]

    day_expr = _taipei_started_at_date()
    q_day = (
        db.query(
            day_expr.label("day_bucket"),
            func.count().label("request_count"),
            func.sum(case((ChatLlmRequest.status == "success", 1), else_=0)).label("success_count"),
            func.sum(case((ChatLlmRequest.status == "error", 1), else_=0)).label("error_count"),
            func.coalesce(func.sum(ChatLlmRequest.total_tokens), 0).label("total_tokens"),
        )
        .filter(*base_filter)
        .group_by(day_expr)
        .order_by(day_expr)
    )
    day_map: dict[date, tuple[int, int, int, int]] = {}
    for bucket, rc, sc, ec, tt in q_day.all():
        if bucket is None:
            continue
        if isinstance(bucket, datetime):
            d = bucket.date()
        elif isinstance(bucket, date):
            d = bucket
        else:
            continue
        day_map[d] = (int(rc), int(sc or 0), int(ec or 0), int(tt))

    # 填滿區間內缺日（圖表連續；日序為台北日曆）
    by_day: list[ChatInsightsDailyRow] = []
    cur = tr.start_date
    while cur <= tr.end_date:
        rc, sc, ec, tt = day_map.get(cur, (0, 0, 0, 0))
        by_day.append(
            ChatInsightsDailyRow(day=cur, request_count=rc, success_count=sc, error_count=ec, total_tokens=tt)
        )
        cur = cur + timedelta(days=1)

    return ChatInsightsOverviewResponse(
        tenant_id=tenant_id,
        start=tr.start_date,
        end=tr.end_date,
        summary=summary,
        by_model=by_model,
        by_status=by_status,
        top_error_codes=top_error_codes,
        by_day=by_day,
    )


# --- B-1／B-2／B-3：使用者维度 ---


class ChatInsightsUsersSummaryResponse(BaseModel):
    tenant_id: str
    start: date
    end: date
    active_users: int = Field(description="區間內至少一筆 LLM 請求且 user_id 非空之相異使用者數")
    total_requests_attributed: int = Field(description="user_id 非空之請求數")
    requests_without_user: int = Field(description="user_id 為空之請求數")
    total_tokens_attributed: int = Field(description="user_id 非空之請求 token 加總")
    avg_requests_per_active_user: float | None = None
    avg_tokens_per_active_user: float | None = None


class ChatInsightsLeaderboardRow(BaseModel):
    user_id: int
    display_label: str = Field(description="依 anonymize 為使用者名稱或匿名標籤")
    username: str | None = Field(None, description="僅 anonymize=false 時提供；true 時為 null")
    request_count: int
    total_tokens: int
    last_activity_at: datetime | None = None


class ChatInsightsLeaderboardResponse(BaseModel):
    tenant_id: str
    start: date
    end: date
    sort: str
    anonymize: bool
    rows: list[ChatInsightsLeaderboardRow]


class ChatInsightsUserThreadRow(BaseModel):
    thread_id: UUID
    title: str | None
    agent_id: str
    last_message_at: datetime | None = None
    request_count_in_range: int
    total_tokens_in_range: int


class ChatInsightsUserThreadsResponse(BaseModel):
    tenant_id: str
    user_id: int
    start: date
    end: date
    display_label: str
    threads: list[ChatInsightsUserThreadRow]


def _label_for_user(*, anonymize: bool, user_id: int, username: str | None, email: str | None) -> str:
    if anonymize:
        return f"使用者 #{user_id}"
    parts = []
    if (username or "").strip():
        parts.append(username.strip())
    if (email or "").strip():
        parts.append(email.strip())
    if parts:
        return " · ".join(parts) if len(parts) > 1 else parts[0]
    return f"user_id {user_id}"


@router.get("/users-summary", response_model=ChatInsightsUsersSummaryResponse)
def chat_insights_users_summary(
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    start: Annotated[date | None, Query(description="起日（台北日曆日）")] = None,
    end: Annotated[date | None, Query(description="迄日（台北日曆日）")] = None,
) -> ChatInsightsUsersSummaryResponse:
    """B-1：活躍使用者數、歸屬請求／token、人均。"""
    _require_admin_insights(current)
    tr = _parse_taipei_calendar_range(start, end)
    tenant_id = current.tenant_id
    base = (
        ChatLlmRequest.tenant_id == tenant_id,
        ChatLlmRequest.started_at >= tr.start_utc,
        ChatLlmRequest.started_at < tr.end_utc_exclusive,
    )

    attributed_filter = base + (ChatLlmRequest.user_id.isnot(None),)
    row_attr = (
        db.query(
            func.count().label("rc"),
            func.coalesce(func.sum(ChatLlmRequest.total_tokens), 0).label("tt"),
        )
        .filter(*attributed_filter)
        .one()
    )
    rc_attr = int(row_attr.rc or 0)
    tt_attr = int(row_attr.tt or 0)

    row_orphan = (
        db.query(func.count())
        .filter(*base, ChatLlmRequest.user_id.is_(None))
        .scalar()
    )
    orphan = int(row_orphan or 0)

    active = (
        db.query(func.count(func.distinct(ChatLlmRequest.user_id)))
        .filter(*attributed_filter)
        .scalar()
    )
    active_n = int(active or 0)

    avg_req: float | None = None
    avg_tok: float | None = None
    if active_n > 0:
        avg_req = round(rc_attr / active_n, 4)
        avg_tok = round(tt_attr / active_n, 4)

    return ChatInsightsUsersSummaryResponse(
        tenant_id=tenant_id,
        start=tr.start_date,
        end=tr.end_date,
        active_users=active_n,
        total_requests_attributed=rc_attr,
        requests_without_user=orphan,
        total_tokens_attributed=tt_attr,
        avg_requests_per_active_user=avg_req,
        avg_tokens_per_active_user=avg_tok,
    )


@router.get("/users-leaderboard", response_model=ChatInsightsLeaderboardResponse)
def chat_insights_users_leaderboard(
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    start: Annotated[date | None, Query()] = None,
    end: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    sort: Annotated[Literal["tokens", "requests"], Query()] = "tokens",
    anonymize: Annotated[bool, Query(description="true 時不暴露 username／email")] = False,
) -> ChatInsightsLeaderboardResponse:
    """B-2：依使用者排行；B-3：anonymize 隱去識別。"""
    _require_admin_insights(current)
    tr = _parse_taipei_calendar_range(start, end)
    tenant_id = current.tenant_id

    sum_tok = func.coalesce(func.sum(ChatLlmRequest.total_tokens), 0)
    order_col = sum_tok if sort == "tokens" else func.count()

    q = (
        db.query(
            ChatLlmRequest.user_id,
            func.count().label("request_count"),
            sum_tok.label("total_tokens"),
            func.max(ChatLlmRequest.started_at).label("last_activity_at"),
        )
        .join(User, User.id == ChatLlmRequest.user_id)
        .filter(
            ChatLlmRequest.tenant_id == tenant_id,
            User.tenant_id == tenant_id,
            ChatLlmRequest.started_at >= tr.start_utc,
            ChatLlmRequest.started_at < tr.end_utc_exclusive,
            ChatLlmRequest.user_id.isnot(None),
        )
        .group_by(ChatLlmRequest.user_id)
        .order_by(order_col.desc())
        .limit(limit)
    )
    rows_raw = q.all()
    if not rows_raw:
        return ChatInsightsLeaderboardResponse(
            tenant_id=tenant_id,
            start=tr.start_date,
            end=tr.end_date,
            sort=sort,
            anonymize=anonymize,
            rows=[],
        )

    user_ids = [int(r.user_id) for r in rows_raw]
    users_map = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    rows_out: list[ChatInsightsLeaderboardRow] = []
    for r in rows_raw:
        uid = int(r.user_id)
        u = users_map.get(uid)
        uname = u.username if u else None
        email = u.email if u else None
        label = _label_for_user(anonymize=anonymize, user_id=uid, username=uname, email=email)
        rows_out.append(
            ChatInsightsLeaderboardRow(
                user_id=uid,
                display_label=label,
                username=None if anonymize else (uname or None),
                request_count=int(r.request_count or 0),
                total_tokens=int(r.total_tokens or 0),
                last_activity_at=r.last_activity_at,
            )
        )

    return ChatInsightsLeaderboardResponse(
        tenant_id=tenant_id,
        start=tr.start_date,
        end=tr.end_date,
        sort=sort,
        anonymize=anonymize,
        rows=rows_out,
    )


@router.get("/users/{user_id}/threads", response_model=ChatInsightsUserThreadsResponse)
def chat_insights_user_threads(
    user_id: int,
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    start: Annotated[date | None, Query()] = None,
    end: Annotated[date | None, Query()] = None,
    anonymize: Annotated[bool, Query()] = False,
) -> ChatInsightsUserThreadsResponse:
    """B-2 下鑽：該使用者在區間內各對話串之 LLM 請求量。"""
    _require_admin_insights(current)
    tr = _parse_taipei_calendar_range(start, end)
    tenant_id = current.tenant_id

    target = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="使用者不存在或不屬於此租戶")

    label = _label_for_user(
        anonymize=anonymize,
        user_id=user_id,
        username=target.username,
        email=target.email,
    )

    agg = (
        db.query(
            ChatLlmRequest.thread_id,
            func.count().label("rc"),
            func.coalesce(func.sum(ChatLlmRequest.total_tokens), 0).label("tt"),
        )
        .filter(
            ChatLlmRequest.tenant_id == tenant_id,
            ChatLlmRequest.user_id == user_id,
            ChatLlmRequest.started_at >= tr.start_utc,
            ChatLlmRequest.started_at < tr.end_utc_exclusive,
        )
        .group_by(ChatLlmRequest.thread_id)
    ).subquery()

    q = (
        db.query(
            ChatThread,
            func.coalesce(agg.c.rc, 0).label("rc"),
            func.coalesce(agg.c.tt, 0).label("tt"),
        )
        .outerjoin(agg, agg.c.thread_id == ChatThread.id)
        .filter(ChatThread.tenant_id == tenant_id, ChatThread.user_id == user_id)
        .order_by(
            func.coalesce(agg.c.tt, 0).desc(),
            ChatThread.last_message_at.desc().nulls_last(),
        )
    )

    threads: list[ChatInsightsUserThreadRow] = []
    for thread, rc, tt in q.all():
        threads.append(
            ChatInsightsUserThreadRow(
                thread_id=thread.id,
                title=thread.title,
                agent_id=thread.agent_id,
                last_message_at=thread.last_message_at,
                request_count_in_range=int(rc or 0),
                total_tokens_in_range=int(tt or 0),
            )
        )

    return ChatInsightsUserThreadsResponse(
        tenant_id=tenant_id,
        user_id=user_id,
        start=tr.start_date,
        end=tr.end_date,
        display_label=label,
        threads=threads,
    )


# --- 儲存空間（Chat 對話／附件；無日期區間，為租戶當下存量） ---


class ChatInsightsStorageTotals(BaseModel):
    thread_count: int = Field(description="租戶內 chat_threads 總數")
    chat_attachment_link_count: int = Field(description="chat_message_attachments 列數（同一檔多次引用會重複計數）")
    chat_attachment_distinct_files: int = Field(description="Chat 附加檔不重複 stored_file 數")
    chat_attachment_total_bytes: int = Field(description="上述不重複檔之 size_bytes 加總")


class ChatInsightsStorageUserThreadsRow(BaseModel):
    user_id: int
    display_label: str
    username: str | None = None
    thread_count: int


class ChatInsightsStorageUserFilesRow(BaseModel):
    user_id: int
    display_label: str
    username: str | None = None
    distinct_file_count: int = Field(description="該使用者底下 Chat 附加檔不重複檔數")
    total_bytes: int = Field(description="上述檔案 size_bytes 加總")


class ChatInsightsStorageResponse(BaseModel):
    tenant_id: str
    anonymize: bool
    totals: ChatInsightsStorageTotals
    top_users_by_thread_count: list[ChatInsightsStorageUserThreadsRow]
    top_users_by_chat_attachment_bytes: list[ChatInsightsStorageUserFilesRow]
    top_users_by_chat_attachment_file_count: list[ChatInsightsStorageUserFilesRow]


def _chat_attachment_distinct_file_subquery(db: Session, *, tenant_id: str):
    """(user_id, file_id, size_bytes) 每檔每使用者至多一列；僅 Chat 附加且未刪檔。"""
    return (
        db.query(
            ChatThread.user_id.label("uid"),
            StoredFile.id.label("fid"),
            StoredFile.size_bytes.label("sz"),
        )
        .select_from(ChatThread)
        .join(ChatMessage, ChatMessage.thread_id == ChatThread.id)
        .join(ChatMessageAttachment, ChatMessageAttachment.message_id == ChatMessage.id)
        .join(StoredFile, StoredFile.id == ChatMessageAttachment.file_id)
        .filter(
            ChatThread.tenant_id == tenant_id,
            StoredFile.tenant_id == tenant_id,
            StoredFile.deleted_at.is_(None),
        )
        .distinct()
    ).subquery()


def _fill_storage_user_labels(
    db: Session,
    *,
    tenant_id: str,
    anonymize: bool,
    user_ids: list[int],
) -> dict[int, tuple[str, str | None]]:
    if not user_ids:
        return {}
    users = (
        db.query(User)
        .filter(User.id.in_(user_ids), User.tenant_id == tenant_id)
        .all()
    )
    out: dict[int, tuple[str, str | None]] = {}
    for u in users:
        label = _label_for_user(
            anonymize=anonymize,
            user_id=u.id,
            username=u.username,
            email=u.email,
        )
        out[u.id] = (label, None if anonymize else (u.username or None))
    for uid in user_ids:
        if uid not in out:
            out[uid] = (_label_for_user(anonymize=anonymize, user_id=uid, username=None, email=None), None)
    return out


@router.get("/storage", response_model=ChatInsightsStorageResponse)
def chat_insights_storage(
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    anonymize: Annotated[bool, Query(description="true 時不暴露 username")] = False,
) -> ChatInsightsStorageResponse:
    """Chat 儲存現況：對話串數、附件檔與空間；各 Top N 使用者。"""
    _require_admin_insights(current)
    tenant_id = current.tenant_id

    thread_count = int(
        db.query(func.count(ChatThread.id)).filter(ChatThread.tenant_id == tenant_id).scalar() or 0
    )
    chat_attachment_link_count = int(
        db.query(func.count(ChatMessageAttachment.id))
        .select_from(ChatMessageAttachment)
        .join(ChatMessage, ChatMessage.id == ChatMessageAttachment.message_id)
        .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
        .filter(ChatThread.tenant_id == tenant_id)
        .scalar()
        or 0
    )

    fsub = _chat_attachment_distinct_file_subquery(db, tenant_id=tenant_id)
    chat_attachment_distinct_files = int(db.query(func.count()).select_from(fsub).scalar() or 0)
    chat_attachment_total_bytes = int(
        db.query(func.coalesce(func.sum(fsub.c.sz), 0)).select_from(fsub).scalar() or 0
    )

    totals = ChatInsightsStorageTotals(
        thread_count=thread_count,
        chat_attachment_link_count=chat_attachment_link_count,
        chat_attachment_distinct_files=chat_attachment_distinct_files,
        chat_attachment_total_bytes=chat_attachment_total_bytes,
    )

    q_threads = (
        db.query(ChatThread.user_id, func.count().label("cnt"))
        .filter(ChatThread.tenant_id == tenant_id)
        .group_by(ChatThread.user_id)
        .order_by(func.count().desc())
        .limit(limit)
    )
    raw_threads = q_threads.all()
    t_uids = [int(r.user_id) for r in raw_threads if r.user_id is not None]
    t_labels = _fill_storage_user_labels(db, tenant_id=tenant_id, anonymize=anonymize, user_ids=t_uids)
    top_threads: list[ChatInsightsStorageUserThreadsRow] = []
    for r in raw_threads:
        if r.user_id is None:
            continue
        uid = int(r.user_id)
        lab, uname = t_labels.get(uid, (f"user_id {uid}", None))
        top_threads.append(
            ChatInsightsStorageUserThreadsRow(
                user_id=uid,
                display_label=lab,
                username=uname,
                thread_count=int(r.cnt or 0),
            )
        )

    agg_sub = (
        db.query(
            fsub.c.uid.label("uid"),
            func.count().label("fc"),
            func.coalesce(func.sum(fsub.c.sz), 0).label("tb"),
        )
        .select_from(fsub)
        .group_by(fsub.c.uid)
    ).subquery()

    raw_bytes = (
        db.query(agg_sub.c.uid, agg_sub.c.fc, agg_sub.c.tb)
        .order_by(agg_sub.c.tb.desc())
        .limit(limit)
        .all()
    )
    raw_count = (
        db.query(agg_sub.c.uid, agg_sub.c.fc, agg_sub.c.tb)
        .order_by(agg_sub.c.fc.desc())
        .limit(limit)
        .all()
    )

    b_uids = list({int(r.uid) for r in raw_bytes if r.uid is not None})
    c_uids = list({int(r.uid) for r in raw_count if r.uid is not None})
    all_uids = list(dict.fromkeys([*b_uids, *c_uids]))
    fc_labels = _fill_storage_user_labels(db, tenant_id=tenant_id, anonymize=anonymize, user_ids=all_uids)

    top_bytes: list[ChatInsightsStorageUserFilesRow] = []
    for r in raw_bytes:
        if r.uid is None:
            continue
        uid = int(r.uid)
        lab, uname = fc_labels.get(uid, (f"user_id {uid}", None))
        top_bytes.append(
            ChatInsightsStorageUserFilesRow(
                user_id=uid,
                display_label=lab,
                username=uname,
                distinct_file_count=int(r.fc or 0),
                total_bytes=int(r.tb or 0),
            )
        )

    top_file_count: list[ChatInsightsStorageUserFilesRow] = []
    for r in raw_count:
        if r.uid is None:
            continue
        uid = int(r.uid)
        lab, uname = fc_labels.get(uid, (f"user_id {uid}", None))
        top_file_count.append(
            ChatInsightsStorageUserFilesRow(
                user_id=uid,
                display_label=lab,
                username=uname,
                distinct_file_count=int(r.fc or 0),
                total_bytes=int(r.tb or 0),
            )
        )

    return ChatInsightsStorageResponse(
        tenant_id=tenant_id,
        anonymize=anonymize,
        totals=totals,
        top_users_by_thread_count=top_threads,
        top_users_by_chat_attachment_bytes=top_bytes,
        top_users_by_chat_attachment_file_count=top_file_count,
    )
