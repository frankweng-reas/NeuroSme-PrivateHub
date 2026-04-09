"""Notebook：notebooks，NotebookLM 類工作區（租戶 + 使用者）"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class Notebook(Base):
    __tablename__ = "notebooks"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id = Column(String(100), nullable=True, index=True)
    title = Column(String(512), nullable=True)
    status = Column(String(32), nullable=False, server_default="active")
    extra_data = Column("extra", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    sources = relationship(
        "NotebookSource",
        back_populates="notebook",
        cascade="all, delete-orphan",
        order_by="NotebookSource.sort_order",
    )
