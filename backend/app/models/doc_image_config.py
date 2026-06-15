"""Doc Image Config ORM：doc_image_configs / doc_image_history"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.database import Base


class DocImageConfig(Base):
    __tablename__ = "doc_image_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(200), nullable=False)
    model = Column(String(200), nullable=False, default="")
    extraction_topics = Column(JSONB, nullable=False, default=list)  # [{name, hint}]
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    history = relationship("DocImageHistory", back_populates="config", cascade="all, delete-orphan")


class DocImageHistory(Base):
    __tablename__ = "doc_image_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    config_id = Column(Integer, ForeignKey("doc_image_configs.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(String(100), nullable=False, index=True)
    user_id = Column(Integer, nullable=True)
    filename = Column(String(500), nullable=False, default="")
    raw_text = Column(Text, nullable=False, default="")
    result_markdown = Column(Text, nullable=False, default="")
    status = Column(String(20), nullable=False, default="success")  # success / error
    error_message = Column(Text, nullable=True)
    model = Column(String(200), nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    config = relationship("DocImageConfig", back_populates="history")
