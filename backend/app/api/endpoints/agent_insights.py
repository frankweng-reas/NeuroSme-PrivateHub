"""Agent 用量洞察：租戶級聚合（admin / super_admin），資料源 agent_usage_logs"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, literal
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent_usage_log import AgentUsageLog
from app.models.chat_llm_request import ChatLlmRequest
from app.models.chat_thread import ChatThread
from app.models.ocr_agent import OcrAgentConfig, OcrExtractionHistory
from app.models.user import User

router = APIRouter()

MAX_RANGE_DAYS = 400
TZ_TAIPEI = ZoneInfo("Asia/Taipei")

# embedding model 識別：model 名稱含 embed
_EMBED_KEYWORD = "embed"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _require_admin(user: User) -> None:
    if str(getattr(user, "role", "")) not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="需 admin 或 super_admin 權限")


@dataclass(frozen=True)
class _DateRangeUtc:
    start_date: date
    end_date: date
    start_utc: datetime
    end_utc_exclusive: datetime


def _parse_range(start: date | None, end: date | None) -> _DateRangeUtc:
    today_taipei = datetime.now(TZ_TAIPEI).date()
    end_d = end or today_taipei
    start_d = start or (end_d - timedelta(days=29))
    if start_d > end_d:
        raise HTTPException(status_code=400, detail="start 不可晚於 end")
    if (end_d - start_d).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"查詢區間不可超過 {MAX_RANGE_DAYS} 天")
    start_utc = datetime.combine(start_d, time(0, 0, 0), tzinfo=TZ_TAIPEI).astimezone(timezone.utc)
    end_utc_exclusive = datetime.combine(
        end_d + timedelta(days=1), time(0, 0, 0), tzinfo=TZ_TAIPEI
    ).astimezone(timezone.utc)
    return _DateRangeUtc(start_d, end_d, start_utc, end_utc_exclusive)


def _created_at_taipei_date():
    """timestamptz → 台北日曆日期（用於 GROUP BY）"""
    return cast(func.timezone(literal("Asia/Taipei"), AgentUsageLog.created_at), Date)


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────


class AgentHealthCard(BaseModel):
    agent_type: str
    total: int
    success: int
    error: int
    success_rate: float          # 0.0–1.0
    p50_latency_ms: int | None   # 中位數延遲


class RecentError(BaseModel):
    id: int
    agent_type: str
    model: str | None
    latency_ms: int | None
    created_at: str              # ISO8601


class AgentHealthResponse(BaseModel):
    start: str
    end: str
    cards: list[AgentHealthCard]
    recent_errors: list[RecentError]


class DailyAgentRow(BaseModel):
    day: str          # YYYY-MM-DD（台北）
    agent_type: str
    request_count: int
    p50_latency_ms: int | None


class AgentDailyTrendResponse(BaseModel):
    start: str
    end: str
    rows: list[DailyAgentRow]


class AgentRankRow(BaseModel):
    agent_type: str
    current: int
    previous: int
    delta: int         # current - previous


class AgentRankingResponse(BaseModel):
    current_start: str
    current_end: str
    previous_start: str
    previous_end: str
    rows: list[AgentRankRow]


class AgentTokenRow(BaseModel):
    agent_type: str
    is_embedding: bool
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class UserTokenRow(BaseModel):
    user_id: int | None
    total_tokens: int


class AgentTokenResponse(BaseModel):
    start: str
    end: str
    by_agent: list[AgentTokenRow]
    top_users: list[UserTokenRow]


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.get("/health", response_model=AgentHealthResponse)
def agent_insights_health(
    start: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    end: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> AgentHealthResponse:
    """每個 agent 的成功率 / 請求數 / 中位數延遲 + 近 50 筆錯誤紀錄"""
    _require_admin(current)
    dr = _parse_range(start, end)
    tenant_id = str(current.tenant_id)

    base_q = db.query(AgentUsageLog).filter(
        AgentUsageLog.tenant_id == tenant_id,
        AgentUsageLog.created_at >= dr.start_utc,
        AgentUsageLog.created_at < dr.end_utc_exclusive,
    )

    from collections import defaultdict
    counts: dict[str, dict] = defaultdict(lambda: {"total": 0, "success": 0, "error": 0})

    # 各 agent_type 的 total / success / error — 三次簡單 GROUP BY，避免跨 DB 相容問題
    total_rows = (
        db.query(AgentUsageLog.agent_type, func.count().label("cnt"))
        .filter(
            AgentUsageLog.tenant_id == tenant_id,
            AgentUsageLog.created_at >= dr.start_utc,
            AgentUsageLog.created_at < dr.end_utc_exclusive,
        )
        .group_by(AgentUsageLog.agent_type)
        .all()
    )
    for r in total_rows:
        counts[r.agent_type]["total"] = r.cnt

    # 分別查 success / error 數量
    for status_val in ("success", "error"):
        rows = (
            db.query(AgentUsageLog.agent_type, func.count().label("cnt"))
            .filter(
                AgentUsageLog.tenant_id == tenant_id,
                AgentUsageLog.created_at >= dr.start_utc,
                AgentUsageLog.created_at < dr.end_utc_exclusive,
                AgentUsageLog.status == status_val,
            )
            .group_by(AgentUsageLog.agent_type)
            .all()
        )
        for r in rows:
            counts[r.agent_type][status_val] = r.cnt

    # p50 延遲：per agent，取中位數（PostgreSQL percentile_cont）
    p50_map: dict[str, int | None] = {}
    try:
        p50_rows = (
            db.query(
                AgentUsageLog.agent_type,
                func.percentile_cont(0.5)
                .within_group(AgentUsageLog.latency_ms)
                .label("p50"),
            )
            .filter(
                AgentUsageLog.tenant_id == tenant_id,
                AgentUsageLog.created_at >= dr.start_utc,
                AgentUsageLog.created_at < dr.end_utc_exclusive,
                AgentUsageLog.latency_ms.isnot(None),
            )
            .group_by(AgentUsageLog.agent_type)
            .all()
        )
        for r in p50_rows:
            p50_map[r.agent_type] = int(r.p50) if r.p50 is not None else None
    except Exception:
        pass

    cards = []
    for agent_type, c in sorted(counts.items()):
        total = c["total"]
        success = c.get("success", 0)
        error = c.get("error", 0)
        cards.append(AgentHealthCard(
            agent_type=agent_type,
            total=total,
            success=success,
            error=error,
            success_rate=round(success / total, 4) if total > 0 else 1.0,
            p50_latency_ms=p50_map.get(agent_type),
        ))

    # 近 50 筆錯誤
    error_logs = (
        base_q.filter(AgentUsageLog.status == "error")
        .order_by(AgentUsageLog.created_at.desc())
        .limit(50)
        .all()
    )
    recent_errors = [
        RecentError(
            id=e.id,
            agent_type=e.agent_type,
            model=e.model,
            latency_ms=e.latency_ms,
            created_at=e.created_at.isoformat(),
        )
        for e in error_logs
    ]

    return AgentHealthResponse(
        start=dr.start_date.isoformat(),
        end=dr.end_date.isoformat(),
        cards=cards,
        recent_errors=recent_errors,
    )


@router.get("/daily-trend", response_model=AgentDailyTrendResponse)
def agent_insights_daily_trend(
    start: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    end: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> AgentDailyTrendResponse:
    """每天每 agent 的請求數 + p50 延遲"""
    _require_admin(current)
    dr = _parse_range(start, end)
    tenant_id = str(current.tenant_id)

    day_col = _created_at_taipei_date()

    # 每日 per agent 請求數
    cnt_rows = (
        db.query(
            day_col.label("day"),
            AgentUsageLog.agent_type,
            func.count().label("request_count"),
        )
        .filter(
            AgentUsageLog.tenant_id == tenant_id,
            AgentUsageLog.created_at >= dr.start_utc,
            AgentUsageLog.created_at < dr.end_utc_exclusive,
        )
        .group_by(day_col, AgentUsageLog.agent_type)
        .order_by(day_col)
        .all()
    )

    # p50 延遲
    p50_rows: list = []
    try:
        p50_rows = (
            db.query(
                day_col.label("day"),
                AgentUsageLog.agent_type,
                func.percentile_cont(0.5)
                .within_group(AgentUsageLog.latency_ms)
                .label("p50"),
            )
            .filter(
                AgentUsageLog.tenant_id == tenant_id,
                AgentUsageLog.created_at >= dr.start_utc,
                AgentUsageLog.created_at < dr.end_utc_exclusive,
                AgentUsageLog.latency_ms.isnot(None),
            )
            .group_by(day_col, AgentUsageLog.agent_type)
            .all()
        )
    except Exception:
        pass

    p50_map: dict[tuple, int | None] = {}
    for r in p50_rows:
        p50_map[(str(r.day), r.agent_type)] = int(r.p50) if r.p50 is not None else None

    rows = [
        DailyAgentRow(
            day=str(r.day),
            agent_type=r.agent_type,
            request_count=r.request_count,
            p50_latency_ms=p50_map.get((str(r.day), r.agent_type)),
        )
        for r in cnt_rows
    ]

    return AgentDailyTrendResponse(
        start=dr.start_date.isoformat(),
        end=dr.end_date.isoformat(),
        rows=rows,
    )


@router.get("/ranking", response_model=AgentRankingResponse)
def agent_insights_ranking(
    start: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    end: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> AgentRankingResponse:
    """本期 + 上一期（等長）各 agent 請求數對比"""
    _require_admin(current)
    dr = _parse_range(start, end)
    tenant_id = str(current.tenant_id)

    span = dr.end_date - dr.start_date  # timedelta
    prev_end = dr.start_date - timedelta(days=1)
    prev_start = prev_end - span

    prev_start_utc = datetime.combine(prev_start, time(0, 0, 0), tzinfo=TZ_TAIPEI).astimezone(timezone.utc)
    prev_end_utc_exclusive = datetime.combine(
        prev_end + timedelta(days=1), time(0, 0, 0), tzinfo=TZ_TAIPEI
    ).astimezone(timezone.utc)

    def _fetch_counts(s_utc: datetime, e_utc: datetime) -> dict[str, int]:
        rows = (
            db.query(AgentUsageLog.agent_type, func.count().label("cnt"))
            .filter(
                AgentUsageLog.tenant_id == tenant_id,
                AgentUsageLog.created_at >= s_utc,
                AgentUsageLog.created_at < e_utc,
            )
            .group_by(AgentUsageLog.agent_type)
            .all()
        )
        return {r.agent_type: r.cnt for r in rows}

    current_counts = _fetch_counts(dr.start_utc, dr.end_utc_exclusive)
    previous_counts = _fetch_counts(prev_start_utc, prev_end_utc_exclusive)

    all_agents = sorted(set(current_counts) | set(previous_counts))
    rows = [
        AgentRankRow(
            agent_type=a,
            current=current_counts.get(a, 0),
            previous=previous_counts.get(a, 0),
            delta=current_counts.get(a, 0) - previous_counts.get(a, 0),
        )
        for a in all_agents
    ]
    rows.sort(key=lambda r: r.current, reverse=True)

    return AgentRankingResponse(
        current_start=dr.start_date.isoformat(),
        current_end=dr.end_date.isoformat(),
        previous_start=prev_start.isoformat(),
        previous_end=prev_end.isoformat(),
        rows=rows,
    )


@router.get("/tokens", response_model=AgentTokenResponse)
def agent_insights_tokens(
    start: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    end: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> AgentTokenResponse:
    """各 agent LLM/embedding token 用量 + top-10 使用者"""
    _require_admin(current)
    dr = _parse_range(start, end)
    tenant_id = str(current.tenant_id)

    base_filter = [
        AgentUsageLog.tenant_id == tenant_id,
        AgentUsageLog.created_at >= dr.start_utc,
        AgentUsageLog.created_at < dr.end_utc_exclusive,
        AgentUsageLog.status == "success",
    ]

    # 各 agent + model 的 token 加總
    token_rows = (
        db.query(
            AgentUsageLog.agent_type,
            AgentUsageLog.model,
            func.coalesce(func.sum(AgentUsageLog.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(AgentUsageLog.completion_tokens), 0).label("completion_tokens"),
            func.coalesce(func.sum(AgentUsageLog.total_tokens), 0).label("total_tokens"),
        )
        .filter(*base_filter)
        .group_by(AgentUsageLog.agent_type, AgentUsageLog.model)
        .all()
    )

    # 合併同一 agent_type（LLM calls vs embedding calls 分開）
    from collections import defaultdict
    agent_buckets: dict[tuple[str, bool], dict] = defaultdict(
        lambda: {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    )
    for r in token_rows:
        is_embed = bool(r.model and _EMBED_KEYWORD in r.model.lower())
        key = (r.agent_type, is_embed)
        agent_buckets[key]["prompt_tokens"] += r.prompt_tokens or 0
        agent_buckets[key]["completion_tokens"] += r.completion_tokens or 0
        agent_buckets[key]["total_tokens"] += r.total_tokens or 0

    by_agent = [
        AgentTokenRow(
            agent_type=agent_type,
            is_embedding=is_embed,
            **vals,
        )
        for (agent_type, is_embed), vals in sorted(agent_buckets.items())
    ]

    # top-10 使用者（以 total_tokens 排序）
    user_rows = (
        db.query(
            AgentUsageLog.user_id,
            func.coalesce(func.sum(AgentUsageLog.total_tokens), 0).label("total_tokens"),
        )
        .filter(*base_filter)
        .group_by(AgentUsageLog.user_id)
        .order_by(func.coalesce(func.sum(AgentUsageLog.total_tokens), 0).desc())
        .limit(10)
        .all()
    )
    top_users = [
        UserTokenRow(user_id=r.user_id, total_tokens=r.total_tokens)
        for r in user_rows
    ]

    return AgentTokenResponse(
        start=dr.start_date.isoformat(),
        end=dr.end_date.isoformat(),
        by_agent=by_agent,
        top_users=top_users,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Users Tab — Schemas
# ──────────────────────────────────────────────────────────────────────────────

_HIGH_ERROR_THRESHOLD = 0.20   # 20% 以上視為需關注
_HIGH_ERROR_MIN_REQUESTS = 5   # 至少 N 筆才計算錯誤率


def _make_user_label(
    *,
    anonymize: bool,
    user_id: int,
    display_name: str | None,
    username: str | None,
    email: str | None,
) -> str:
    if anonymize:
        return f"使用者 #{user_id}"
    parts: list[str] = []
    if (display_name or "").strip():
        parts.append(display_name.strip())  # type: ignore[union-attr]
    if (username or "").strip():
        parts.append(f"@{username.strip()}")  # type: ignore[union-attr]
    if not parts and (email or "").strip():
        parts.append(email.strip())  # type: ignore[union-attr]
    return " ".join(parts) or f"使用者 #{user_id}"


class UsersOverviewResponse(BaseModel):
    start: str
    end: str
    active_users: int
    avg_tokens_per_user: int | None
    multi_agent_users: int          # 使用 ≥2 種 agent 的人數
    high_error_users: int           # 錯誤率 >20%（且 ≥5 次請求）


class UserAgentStat(BaseModel):
    agent_type: str
    request_count: int
    total_tokens: int


class UserLeaderboardRow(BaseModel):
    user_id: int
    display_label: str
    username: str | None
    total_requests: int
    total_tokens: int
    error_count: int
    error_rate: float
    active_days: int
    last_activity_at: str
    agents: list[UserAgentStat]     # 每種 agent 的摘要，用於色塊顯示


class UsersLeaderboardResponse(BaseModel):
    start: str
    end: str
    rows: list[UserLeaderboardRow]


class UserAgentBreakdownRow(BaseModel):
    agent_type: str
    request_count: int
    total_tokens: int
    error_count: int
    error_rate: float
    last_activity_at: str


class UserBreakdownResponse(BaseModel):
    user_id: int
    display_label: str
    start: str
    end: str
    agents: list[UserAgentBreakdownRow]


class UserChatThreadRow(BaseModel):
    thread_id: str
    title: str | None
    agent_id: str
    request_count_in_range: int
    total_tokens_in_range: int
    last_message_at: str | None


class UserChatThreadsResponse(BaseModel):
    user_id: int
    display_label: str
    start: str
    end: str
    threads: list[UserChatThreadRow]


class UserOcrHistoryRow(BaseModel):
    id: int
    config_name: str
    filename: str
    status: str
    total_tokens: int | None
    created_at: str


class UserOcrHistoryResponse(BaseModel):
    user_id: int
    display_label: str
    start: str
    end: str
    rows: list[UserOcrHistoryRow]


# ──────────────────────────────────────────────────────────────────────────────
# Users Tab — Endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.get("/users/overview", response_model=UsersOverviewResponse)
def agent_insights_users_overview(
    start: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    end: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> UsersOverviewResponse:
    """摘要卡片：活躍人數、人均 tokens、多 agent 用戶、需關注用戶。"""
    _require_admin(current)
    dr = _parse_range(start, end)
    tenant_id = str(current.tenant_id)

    # 一次撈出 user_id + agent_type 的 count + tokens，在 Python 端聚合
    rows = (
        db.query(
            AgentUsageLog.user_id,
            AgentUsageLog.agent_type,
            AgentUsageLog.status,
            func.count().label("cnt"),
            func.coalesce(func.sum(AgentUsageLog.total_tokens), 0).label("tokens"),
        )
        .filter(
            AgentUsageLog.tenant_id == tenant_id,
            AgentUsageLog.created_at >= dr.start_utc,
            AgentUsageLog.created_at < dr.end_utc_exclusive,
            AgentUsageLog.user_id.isnot(None),
        )
        .group_by(AgentUsageLog.user_id, AgentUsageLog.agent_type, AgentUsageLog.status)
        .all()
    )

    user_data: dict[int, dict] = defaultdict(
        lambda: {"total": 0, "errors": 0, "tokens": 0, "agents": set()}
    )
    for r in rows:
        user_data[r.user_id]["total"] += r.cnt
        if r.status == "error":
            user_data[r.user_id]["errors"] += r.cnt
        user_data[r.user_id]["tokens"] += r.tokens
        user_data[r.user_id]["agents"].add(r.agent_type)

    active_users = len(user_data)
    avg_tokens: int | None = (
        int(sum(d["tokens"] for d in user_data.values()) / active_users)
        if active_users > 0
        else None
    )
    multi_agent = sum(1 for d in user_data.values() if len(d["agents"]) >= 2)
    high_error = sum(
        1
        for d in user_data.values()
        if d["total"] >= _HIGH_ERROR_MIN_REQUESTS
        and d["errors"] / d["total"] > _HIGH_ERROR_THRESHOLD
    )

    return UsersOverviewResponse(
        start=dr.start_date.isoformat(),
        end=dr.end_date.isoformat(),
        active_users=active_users,
        avg_tokens_per_user=avg_tokens,
        multi_agent_users=multi_agent,
        high_error_users=high_error,
    )


@router.get("/users/leaderboard", response_model=UsersLeaderboardResponse)
def agent_insights_users_leaderboard(
    start: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    end: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    sort: Annotated[str, Query(description="tokens | requests | active_days | error_rate")] = "tokens",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    anonymize: Annotated[bool, Query()] = False,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> UsersLeaderboardResponse:
    """使用者排行榜：跨所有 agents 的用量，含每種 agent 色塊資料。"""
    _require_admin(current)
    dr = _parse_range(start, end)
    tenant_id = str(current.tenant_id)
    day_col = _created_at_taipei_date()

    # Query 1: per user + agent_type + status 的 count / tokens
    stat_rows = (
        db.query(
            AgentUsageLog.user_id,
            AgentUsageLog.agent_type,
            AgentUsageLog.status,
            func.count().label("cnt"),
            func.coalesce(func.sum(AgentUsageLog.total_tokens), 0).label("tokens"),
        )
        .filter(
            AgentUsageLog.tenant_id == tenant_id,
            AgentUsageLog.created_at >= dr.start_utc,
            AgentUsageLog.created_at < dr.end_utc_exclusive,
            AgentUsageLog.user_id.isnot(None),
        )
        .group_by(AgentUsageLog.user_id, AgentUsageLog.agent_type, AgentUsageLog.status)
        .all()
    )

    # Query 2: per user 的 active_days + last_activity_at
    day_rows = (
        db.query(
            AgentUsageLog.user_id,
            func.count(func.distinct(day_col)).label("active_days"),
            func.max(AgentUsageLog.created_at).label("last_at"),
        )
        .filter(
            AgentUsageLog.tenant_id == tenant_id,
            AgentUsageLog.created_at >= dr.start_utc,
            AgentUsageLog.created_at < dr.end_utc_exclusive,
            AgentUsageLog.user_id.isnot(None),
        )
        .group_by(AgentUsageLog.user_id)
        .all()
    )

    # 在 Python 端聚合
    per_user: dict[int, dict] = defaultdict(
        lambda: {
            "total": 0, "errors": 0, "tokens": 0,
            "agents": defaultdict(lambda: {"cnt": 0, "tokens": 0}),
        }
    )
    for r in stat_rows:
        per_user[r.user_id]["total"] += r.cnt
        if r.status == "error":
            per_user[r.user_id]["errors"] += r.cnt
        per_user[r.user_id]["tokens"] += r.tokens
        per_user[r.user_id]["agents"][r.agent_type]["cnt"] += r.cnt
        per_user[r.user_id]["agents"][r.agent_type]["tokens"] += r.tokens

    day_map: dict[int, tuple[int, datetime]] = {}
    for r in day_rows:
        day_map[r.user_id] = (int(r.active_days), r.last_at)

    # 撈 User 資訊
    user_ids = list(per_user.keys())
    user_objs = db.query(User).filter(User.id.in_(user_ids)).all()
    user_map = {u.id: u for u in user_objs}

    # 組裝 rows
    result_rows: list[UserLeaderboardRow] = []
    for uid, data in per_user.items():
        u = user_map.get(uid)
        label = _make_user_label(
            anonymize=anonymize,
            user_id=uid,
            display_name=u.display_name if u else None,
            username=u.username if u else None,
            email=u.email if u else None,
        )
        active_days, last_at = day_map.get(uid, (0, datetime.now(timezone.utc)))
        total = data["total"]
        errors = data["errors"]
        result_rows.append(
            UserLeaderboardRow(
                user_id=uid,
                display_label=label,
                username=None if anonymize else (u.username if u else None),
                total_requests=total,
                total_tokens=data["tokens"],
                error_count=errors,
                error_rate=round(errors / total, 4) if total > 0 else 0.0,
                active_days=active_days,
                last_activity_at=last_at.isoformat(),
                agents=[
                    UserAgentStat(
                        agent_type=at,
                        request_count=v["cnt"],
                        total_tokens=v["tokens"],
                    )
                    for at, v in data["agents"].items()
                ],
            )
        )

    # 排序
    sort_key = {
        "tokens": lambda r: r.total_tokens,
        "requests": lambda r: r.total_requests,
        "active_days": lambda r: r.active_days,
        "error_rate": lambda r: r.error_rate,
    }.get(sort, lambda r: r.total_tokens)
    result_rows.sort(key=sort_key, reverse=True)

    return UsersLeaderboardResponse(
        start=dr.start_date.isoformat(),
        end=dr.end_date.isoformat(),
        rows=result_rows[:limit],
    )


@router.get("/users/search", response_model=UsersLeaderboardResponse)
def agent_insights_users_search(
    q: Annotated[str, Query(description="搜尋關鍵字（username / display_name / email）", min_length=1)],
    start: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    end: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    anonymize: Annotated[bool, Query()] = False,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> UsersLeaderboardResponse:
    """依 username / display_name / email 搜尋使用者，回傳其在區間內的用量。"""
    _require_admin(current)
    dr = _parse_range(start, end)
    tenant_id = str(current.tenant_id)

    pattern = f"%{q}%"
    matched_users = (
        db.query(User)
        .filter(
            User.tenant_id == tenant_id,
            (
                User.username.ilike(pattern)
                | User.display_name.ilike(pattern)
                | User.email.ilike(pattern)
            ),
        )
        .limit(20)
        .all()
    )
    if not matched_users:
        return UsersLeaderboardResponse(
            start=dr.start_date.isoformat(),
            end=dr.end_date.isoformat(),
            rows=[],
        )

    user_ids = [u.id for u in matched_users]
    user_map = {u.id: u for u in matched_users}

    # 撈這批人在區間內的用量
    stat_rows = (
        db.query(
            AgentUsageLog.user_id,
            AgentUsageLog.agent_type,
            AgentUsageLog.status,
            func.count().label("cnt"),
            func.coalesce(func.sum(AgentUsageLog.total_tokens), 0).label("tokens"),
        )
        .filter(
            AgentUsageLog.tenant_id == tenant_id,
            AgentUsageLog.user_id.in_(user_ids),
            AgentUsageLog.created_at >= dr.start_utc,
            AgentUsageLog.created_at < dr.end_utc_exclusive,
        )
        .group_by(AgentUsageLog.user_id, AgentUsageLog.agent_type, AgentUsageLog.status)
        .all()
    )

    day_col = _created_at_taipei_date()
    day_rows = (
        db.query(
            AgentUsageLog.user_id,
            func.count(func.distinct(day_col)).label("active_days"),
            func.max(AgentUsageLog.created_at).label("last_at"),
        )
        .filter(
            AgentUsageLog.tenant_id == tenant_id,
            AgentUsageLog.user_id.in_(user_ids),
            AgentUsageLog.created_at >= dr.start_utc,
            AgentUsageLog.created_at < dr.end_utc_exclusive,
        )
        .group_by(AgentUsageLog.user_id)
        .all()
    )
    day_map: dict[int, tuple[int, datetime]] = {
        r.user_id: (int(r.active_days), r.last_at) for r in day_rows
    }

    per_user: dict[int, dict] = defaultdict(
        lambda: {
            "total": 0, "errors": 0, "tokens": 0,
            "agents": defaultdict(lambda: {"cnt": 0, "tokens": 0}),
        }
    )
    for r in stat_rows:
        per_user[r.user_id]["total"] += r.cnt
        if r.status == "error":
            per_user[r.user_id]["errors"] += r.cnt
        per_user[r.user_id]["tokens"] += r.tokens
        per_user[r.user_id]["agents"][r.agent_type]["cnt"] += r.cnt
        per_user[r.user_id]["agents"][r.agent_type]["tokens"] += r.tokens

    rows_out: list[UserLeaderboardRow] = []
    for u in matched_users:
        data = per_user.get(u.id, {"total": 0, "errors": 0, "tokens": 0, "agents": {}})
        active_days, last_at = day_map.get(u.id, (0, datetime.now(timezone.utc)))
        total = data["total"]
        errors = data["errors"]
        rows_out.append(
            UserLeaderboardRow(
                user_id=u.id,
                display_label=_make_user_label(
                    anonymize=anonymize,
                    user_id=u.id,
                    display_name=u.display_name,
                    username=u.username,
                    email=u.email,
                ),
                username=None if anonymize else (u.username or None),
                total_requests=total,
                total_tokens=data["tokens"],
                error_count=errors,
                error_rate=round(errors / total, 4) if total > 0 else 0.0,
                active_days=active_days,
                last_activity_at=last_at.isoformat(),
                agents=[
                    UserAgentStat(
                        agent_type=at,
                        request_count=v["cnt"],
                        total_tokens=v["tokens"],
                    )
                    for at, v in data["agents"].items()
                ],
            )
        )

    return UsersLeaderboardResponse(
        start=dr.start_date.isoformat(),
        end=dr.end_date.isoformat(),
        rows=rows_out,
    )


@router.get("/users/{user_id}/breakdown", response_model=UserBreakdownResponse)
def agent_insights_user_breakdown(
    user_id: int,
    start: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    end: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    anonymize: Annotated[bool, Query()] = False,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> UserBreakdownResponse:
    """Level 1 下鑽：該使用者各 agent 的詳細用量。"""
    _require_admin(current)
    dr = _parse_range(start, end)
    tenant_id = str(current.tenant_id)

    rows = (
        db.query(
            AgentUsageLog.agent_type,
            AgentUsageLog.status,
            func.count().label("cnt"),
            func.coalesce(func.sum(AgentUsageLog.total_tokens), 0).label("tokens"),
            func.max(AgentUsageLog.created_at).label("last_at"),
        )
        .filter(
            AgentUsageLog.tenant_id == tenant_id,
            AgentUsageLog.user_id == user_id,
            AgentUsageLog.created_at >= dr.start_utc,
            AgentUsageLog.created_at < dr.end_utc_exclusive,
        )
        .group_by(AgentUsageLog.agent_type, AgentUsageLog.status)
        .all()
    )

    agent_data: dict[str, dict] = defaultdict(
        lambda: {"total": 0, "errors": 0, "tokens": 0, "last_at": None}
    )
    for r in rows:
        agent_data[r.agent_type]["total"] += r.cnt
        if r.status == "error":
            agent_data[r.agent_type]["errors"] += r.cnt
        agent_data[r.agent_type]["tokens"] += r.tokens
        if agent_data[r.agent_type]["last_at"] is None or (
            r.last_at and r.last_at > agent_data[r.agent_type]["last_at"]
        ):
            agent_data[r.agent_type]["last_at"] = r.last_at

    u = db.query(User).filter(User.id == user_id).first()
    label = _make_user_label(
        anonymize=anonymize,
        user_id=user_id,
        display_name=u.display_name if u else None,
        username=u.username if u else None,
        email=u.email if u else None,
    )

    agents_out = [
        UserAgentBreakdownRow(
            agent_type=at,
            request_count=d["total"],
            total_tokens=d["tokens"],
            error_count=d["errors"],
            error_rate=round(d["errors"] / d["total"], 4) if d["total"] > 0 else 0.0,
            last_activity_at=(d["last_at"] or datetime.now(timezone.utc)).isoformat(),
        )
        for at, d in sorted(agent_data.items(), key=lambda x: x[1]["tokens"], reverse=True)
    ]

    return UserBreakdownResponse(
        user_id=user_id,
        display_label=label,
        start=dr.start_date.isoformat(),
        end=dr.end_date.isoformat(),
        agents=agents_out,
    )


@router.get("/users/{user_id}/chat-threads", response_model=UserChatThreadsResponse)
def agent_insights_user_chat_threads(
    user_id: int,
    start: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    end: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    anonymize: Annotated[bool, Query()] = False,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> UserChatThreadsResponse:
    """Level 2 下鑽（Chat）：該使用者在區間內有活動的對話串。"""
    _require_admin(current)
    dr = _parse_range(start, end)
    tenant_id = str(current.tenant_id)

    # 找出在區間內有 LLM 請求的 thread_id
    req_rows = (
        db.query(
            ChatLlmRequest.thread_id,
            func.count().label("req_cnt"),
            func.coalesce(func.sum(ChatLlmRequest.total_tokens), 0).label("tokens"),
        )
        .filter(
            ChatLlmRequest.tenant_id == tenant_id,
            ChatLlmRequest.user_id == user_id,
            ChatLlmRequest.started_at >= dr.start_utc,
            ChatLlmRequest.started_at < dr.end_utc_exclusive,
        )
        .group_by(ChatLlmRequest.thread_id)
        .all()
    )

    thread_ids = [r.thread_id for r in req_rows]
    req_map = {r.thread_id: (int(r.req_cnt), int(r.tokens)) for r in req_rows}

    threads: list[UserChatThreadRow] = []
    if thread_ids:
        thread_objs = (
            db.query(ChatThread)
            .filter(ChatThread.id.in_(thread_ids))
            .order_by(ChatThread.last_message_at.desc().nullslast())
            .all()
        )
        threads = [
            UserChatThreadRow(
                thread_id=str(t.id),
                title=t.title,
                agent_id=t.agent_id,
                request_count_in_range=req_map.get(t.id, (0, 0))[0],
                total_tokens_in_range=req_map.get(t.id, (0, 0))[1],
                last_message_at=t.last_message_at.isoformat() if t.last_message_at else None,
            )
            for t in thread_objs
        ]

    u = db.query(User).filter(User.id == user_id).first()
    label = _make_user_label(
        anonymize=anonymize,
        user_id=user_id,
        display_name=u.display_name if u else None,
        username=u.username if u else None,
        email=u.email if u else None,
    )

    return UserChatThreadsResponse(
        user_id=user_id,
        display_label=label,
        start=dr.start_date.isoformat(),
        end=dr.end_date.isoformat(),
        threads=threads,
    )


@router.get("/users/{user_id}/ocr-history", response_model=UserOcrHistoryResponse)
def agent_insights_user_ocr_history(
    user_id: int,
    start: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    end: Annotated[date | None, Query(description="台北日期 YYYY-MM-DD")] = None,
    anonymize: Annotated[bool, Query()] = False,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> UserOcrHistoryResponse:
    """Level 2 下鑽（OCR）：該使用者在區間內的文件辨識紀錄。"""
    _require_admin(current)
    dr = _parse_range(start, end)
    tenant_id = str(current.tenant_id)

    hist_rows = (
        db.query(OcrExtractionHistory, OcrAgentConfig.name.label("config_name"))
        .join(OcrAgentConfig, OcrExtractionHistory.config_id == OcrAgentConfig.id)
        .filter(
            OcrExtractionHistory.tenant_id == tenant_id,
            OcrExtractionHistory.user_id == user_id,
            OcrExtractionHistory.created_at >= dr.start_utc,
            OcrExtractionHistory.created_at < dr.end_utc_exclusive,
        )
        .order_by(OcrExtractionHistory.created_at.desc())
        .limit(100)
        .all()
    )

    u = db.query(User).filter(User.id == user_id).first()
    label = _make_user_label(
        anonymize=anonymize,
        user_id=user_id,
        display_name=u.display_name if u else None,
        username=u.username if u else None,
        email=u.email if u else None,
    )

    rows_out = [
        UserOcrHistoryRow(
            id=h.OcrExtractionHistory.id,
            config_name=h.config_name or "—",
            filename=h.OcrExtractionHistory.filename or "—",
            status=h.OcrExtractionHistory.status,
            total_tokens=h.OcrExtractionHistory.total_tokens,
            created_at=h.OcrExtractionHistory.created_at.isoformat(),
        )
        for h in hist_rows
    ]

    return UserOcrHistoryResponse(
        user_id=user_id,
        display_label=label,
        start=dr.start_date.isoformat(),
        end=dr.end_date.isoformat(),
        rows=rows_out,
    )
