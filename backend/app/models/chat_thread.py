"""ChatThread：chat_threads，對話串（租戶 + 使用者 + agent）"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id = Column(String(100), nullable=False, index=True)
    title = Column(String(512), nullable=True)
    status = Column(String(32), nullable=False, server_default="active")
    last_message_at = Column(DateTime(timezone=True), nullable=True)
    extra_data = Column("extra", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    messages = relationship(
        "ChatMessage",
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="ChatMessage.sequence",
    )
    llm_requests = relationship(
        "ChatLlmRequest",
        back_populates="thread",
        cascade="all, delete-orphan",
    )
