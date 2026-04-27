"""AgentUsageLog：所有 Agent LLM 呼叫的統一監控記錄"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.core.database import Base


class AgentUsageLog(Base):
    __tablename__ = "agent_usage_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_type = Column(String(50), nullable=False, index=True)   # chat / ocr / speech / ...
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    model = Column(String(200), nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    status = Column(String(20), nullable=False, server_default="success")  # success / error
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
