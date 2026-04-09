"""StoredFile：stored_files，上傳檔元資料（實體位於 STORED_FILES_DIR）"""
from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class StoredFile(Base):
    __tablename__ = "stored_files"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    uploaded_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    storage_backend = Column(String(32), nullable=False, server_default="local")
    storage_rel_path = Column(Text, nullable=False, unique=True)
    original_filename = Column(String(512), nullable=False)
    content_type = Column(String(255), nullable=True)
    size_bytes = Column(BigInteger, nullable=False)
    sha256_hex = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    chat_message_attachments = relationship("ChatMessageAttachment", back_populates="file")
    notebook_sources = relationship("NotebookSource", back_populates="file")
