"""Agent API 回應結構 (AgentResponse)"""
from pydantic import BaseModel

from app.models.agent import Agent


def _agent_composite_id(agent: Agent) -> str:
    """API 用 id：tenant_id:id，全域唯一"""
    return f"{agent.tenant_id}:{agent.id}"


class AgentResponse(BaseModel):
    id: str  # tenant_id:id 格式，全域唯一
    group_id: str
    group_name: str
    agent_id: str
    agent_name: str
    icon_name: str | None = None
    is_purchased: bool = False
    tenant_id: str = ""

    class Config:
        from_attributes = True

    @classmethod
    def from_agent(cls, agent: Agent) -> "AgentResponse":
        """從 Agent ORM 建立，id 為 tenant_id:id"""
        return cls(
            id=_agent_composite_id(agent),
            group_id=agent.group_id,
            group_name=agent.group_name,
            agent_id=agent.agent_id,
            agent_name=agent.agent_name,
            icon_name=agent.icon_name,
            is_purchased=agent.is_purchased,
            tenant_id=agent.tenant_id,
        )
