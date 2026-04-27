"""OCR Agent ORM：ocr_agent_configs / ocr_extraction_history"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.database import Base


class OcrAgentConfig(Base):
    __tablename__ = "ocr_agent_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(200), nullable=False)
    data_type_label = Column(String(100), nullable=False, default="")
    model = Column(String(200), nullable=False, default="")
    output_fields = Column(JSONB, nullable=False, default=list)  # [{name, hint}]
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    history = relationship("OcrExtractionHistory", back_populates="config", cascade="all, delete-orphan")


class OcrExtractionHistory(Base):
    __tablename__ = "ocr_extraction_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    config_id = Column(Integer, ForeignKey("ocr_agent_configs.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(String(100), nullable=False, index=True)
    user_id = Column(Integer, nullable=True)
    filename = Column(String(500), nullable=False, default="")
    raw_text = Column(Text, nullable=False, default="")
    extracted_fields = Column(JSONB, nullable=False, default=dict)
    status = Column(String(20), nullable=False, default="success")  # success / error
    error_message = Column(Text, nullable=True)
    # usage monitoring
    model = Column(String(200), nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    config = relationship("OcrAgentConfig", back_populates="history")
