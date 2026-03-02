"""UserAgent 關聯表：使用者可存取的 agent，PK 為 (tenant_id, user_id, agent_id)"""
from sqlalchemy import Column, ForeignKey, ForeignKeyConstraint, Integer, String
from app.core.database import Base


class UserAgent(Base):
    __tablename__ = "user_agents"

    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    agent_id = Column(String(100), primary_key=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "agent_id"],
            ["agents.tenant_id", "agents.id"],
            ondelete="CASCADE",
        ),
    )
