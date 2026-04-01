"""權限 service：查詢使用者可存取的 agent（一律以業務 agent_id = agent_catalog.agent_id）"""
from sqlalchemy.orm import Session

from app.models.agent_catalog import AgentCatalog
from app.models.tenant_agent import TenantAgent
from app.models.user import User
from app.models.user_agent import UserAgent


def resolve_agent_catalog(db: Session, aid: str) -> AgentCatalog | None:
    """以 agent_id（主鍵）查詢 AgentCatalog。"""
    key = (aid or "").strip()
    if not key:
        return None
    return db.query(AgentCatalog).filter(AgentCatalog.agent_id == key).first()


def get_agent_ids_for_user(db: Session, user_id: int) -> set[str]:
    """回傳該 user 可存取的 **業務 agent_id** 集合（等同 agent_catalog.agent_id）。

    條件：tenant 已購買（tenant_agents）且 user 已授權（user_agents），兩表存的都是業務 agent_id。
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return set()
    # user 有授權的 agents
    user_agent_ids = {
        r.agent_id
        for r in db.query(UserAgent.agent_id).filter(
            UserAgent.user_id == user_id,
            UserAgent.tenant_id == user.tenant_id,
        ).all()
    }
    # tenant 已購買的 agents
    tenant_agent_ids = {
        r.agent_id
        for r in db.query(TenantAgent.agent_id).filter(
            TenantAgent.tenant_id == user.tenant_id,
        ).all()
    }
    return user_agent_ids & tenant_agent_ids
