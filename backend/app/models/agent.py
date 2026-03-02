"""Agent ORM：對應 agents 表，PK 為 (tenant_id, id)"""
from sqlalchemy import Boolean, Column, ForeignKey, String
from sqlalchemy.orm import relationship
from app.core.database import Base


class Agent(Base):
    __tablename__ = "agents"

    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), primary_key=True, index=True)
    id = Column(String(100), primary_key=True, index=True)  # tenant 內唯一
    group_id = Column(String(100), nullable=False, index=True)
    group_name = Column(String(255), nullable=False)
    agent_id = Column(String(100), nullable=False, index=True)
    agent_name = Column(String(255), nullable=False)
    icon_name = Column(String(100), nullable=True)
    is_purchased = Column(Boolean, nullable=False, default=False)

    tenant = relationship("Tenant", backref="agents")
    users = relationship(
        "User",
        secondary="user_agents",
        back_populates="agents",
        lazy="selectin",
    )
