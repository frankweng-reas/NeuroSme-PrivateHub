"""統一 Agent 使用量記錄 service

所有 agent 在 LLM 呼叫完成後呼叫 log_agent_usage()，
將 token 用量、延遲、狀態寫入 agent_usage_logs 表。

用法範例：
    from app.services.agent_usage import log_agent_usage

    log_agent_usage(
        db=db,
        agent_type="ocr",
        tenant_id=tenant_id,
        user_id=current.id,
        model=cfg.model,
        prompt_tokens=120,
        completion_tokens=80,
        total_tokens=200,
        latency_ms=3200,
        status="success",
    )
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.models.agent_usage_log import AgentUsageLog

logger = logging.getLogger(__name__)

VALID_AGENT_TYPES = frozenset({"chat", "ocr", "speech"})


def log_agent_usage(
    db: Session,
    *,
    agent_type: str,
    tenant_id: str,
    user_id: int | None = None,
    model: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
    latency_ms: int | None = None,
    status: str = "success",
) -> None:
    """
    寫入一筆 agent 使用紀錄。

    此函式設計為 fire-and-forget：即便寫入失敗，不應中斷主流程，
    因此內部 catch 所有例外並只記 warning log。
    """
    try:
        entry = AgentUsageLog(
            agent_type=agent_type,
            tenant_id=tenant_id,
            user_id=user_id,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            status=status,
        )
        db.add(entry)
        db.flush()  # 與外層 transaction 合併，不單獨 commit
    except Exception as exc:  # noqa: BLE001
        logger.warning("log_agent_usage failed (agent_type=%s): %s", agent_type, exc)
