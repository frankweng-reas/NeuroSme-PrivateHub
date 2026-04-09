"""ChatLlmRequest：chat_llm_requests，LLM 呼叫觀測（latency、token、trace）"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class ChatLlmRequest(Base):
    __tablename__ = "chat_llm_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    thread_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chat_threads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    model = Column(String(255), nullable=True)
    provider = Column(String(64), nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(32), nullable=False, server_default="pending")
    error_code = Column(String(64), nullable=True)
    error_message = Column(Text, nullable=True)
    trace_id = Column(String(128), nullable=True, index=True)
    extra_data = Column("extra", JSONB, nullable=True)

    thread = relationship("ChatThread", back_populates="llm_requests")
    assistant_messages = relationship(
        "ChatMessage",
        back_populates="llm_request",
        foreign_keys="ChatMessage.llm_request_id",
    )
