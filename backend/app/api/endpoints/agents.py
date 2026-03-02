"""Agents API：GET /agents/ 列表、GET /agents/{id} 單筆；需登入，依當前使用者權限過濾"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent import Agent
from app.models.user import User
from app.schemas.agent import AgentResponse
from app.services.permission import get_agent_ids_for_user

router = APIRouter()


def _parse_agent_id(agent_id: str, fallback_tenant_id: str) -> tuple[str, str]:
    """解析 agent_id：支援 tenant_id:id 或 僅 id（用 fallback_tenant_id）"""
    if ":" in agent_id:
        tenant_id, aid = agent_id.split(":", 1)
        return tenant_id, aid
    return fallback_tenant_id, agent_id


@router.get("/", response_model=list[AgentResponse])
def list_agents(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
    is_purchased: str | None = Query(None, description="傳 'true' 則只回傳 is_purchased=True 的 agents"),
):
    """取得 agents 列表。admin 且 is_purchased 時回傳 tenant 內所有已購買的 agents（供權限設定用）；否則依當前使用者權限過濾"""
    user = current
    agents = db.query(Agent).filter(Agent.tenant_id == user.tenant_id).order_by(Agent.id).all()
    if is_purchased and str(is_purchased).lower() == "true":
        agents = [a for a in agents if a.is_purchased]
        if user.role == "admin":
            return [AgentResponse.from_agent(a) for a in agents]
    allowed_ids = get_agent_ids_for_user(db, user.id)
    agents = [a for a in agents if a.id in allowed_ids]
    return [AgentResponse.from_agent(a) for a in agents]


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得單一 agent（需有權限）"""
    tenant_id, aid = _parse_agent_id(agent_id, current.tenant_id)
    agent = db.query(Agent).filter(
        Agent.tenant_id == tenant_id,
        Agent.id == aid,
    ).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    allowed_ids = get_agent_ids_for_user(db, current.id)
    if agent.id not in allowed_ids:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    return AgentResponse.from_agent(agent)
