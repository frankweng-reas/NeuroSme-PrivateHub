"""LlmSkill ORM：llm_skills，跨 Agent 可重複使用的 LLM prompt 範本（by tenant）"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func

from app.core.database import Base


class LlmSkill(Base):
    __tablename__ = "llm_skills"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(200), nullable=False)
    category = Column(String(100), nullable=True)
    description = Column(String(500), nullable=True)
    prompt = Column(Text, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
