"""TenantAgent 關聯表：客戶買了哪些 agent"""
from sqlalchemy import Column, ForeignKey, String
from app.core.database import Base


class TenantAgent(Base):
    __tablename__ = "tenant_agents"

    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    agent_id = Column(String(100), ForeignKey("agent_catalog.agent_id", ondelete="CASCADE"), primary_key=True)
