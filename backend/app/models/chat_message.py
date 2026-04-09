"""ChatMessage：chat_messages，對話訊息"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    thread_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chat_threads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequence = Column(Integer, nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    llm_request_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chat_llm_requests.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    #: 非 NULL：該則 user 訊息錨定本段附件集合（UUID 字串之 JSON 陣列）；NULL：沿用上一錨點
    context_file_ids = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    thread = relationship("ChatThread", back_populates="messages")
    llm_request = relationship(
        "ChatLlmRequest",
        back_populates="assistant_messages",
        foreign_keys=[llm_request_id],
    )
    attachments = relationship(
        "ChatMessageAttachment",
        back_populates="message",
        cascade="all, delete-orphan",
        order_by="ChatMessageAttachment.created_at",
    )
