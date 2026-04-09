"""ChatMessageAttachment：chat_message_attachments，對話訊息附加的檔案"""
from sqlalchemy import Column, DateTime, ForeignKey, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class ChatMessageAttachment(Base):
    __tablename__ = "chat_message_attachments"
    __table_args__ = (
        UniqueConstraint("message_id", "file_id", name="uq_chat_message_attachments_message_file"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_id = Column(
        UUID(as_uuid=True),
        ForeignKey("stored_files.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    message = relationship("ChatMessage", back_populates="attachments")
    file = relationship("StoredFile", back_populates="chat_message_attachments")
