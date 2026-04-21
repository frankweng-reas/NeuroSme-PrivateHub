"""TenantConfig ORM：對應 tenant_configs 表，儲存每個租戶的預設 LLM 與 Embedding 設定"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from app.core.database import Base


class TenantConfig(Base):
    __tablename__ = "tenant_configs"

    tenant_id = Column(
        String(100),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # LLM 預設（可隨時更改）
    default_llm_provider = Column(String(50), nullable=True)   # openai | gemini | twcc | local
    default_llm_model = Column(String(255), nullable=True)     # 例：gemini/gemini-2.5-flash

    # Embedding（第一次寫入後鎖定，更換需走遷移流程）
    embedding_provider = Column(String(50), nullable=False, server_default="openai")
    embedding_model = Column(String(255), nullable=False, server_default="text-embedding-3-small")
    embedding_locked_at = Column(DateTime(timezone=True), nullable=True)   # null = 尚未鎖定
    embedding_version = Column(Integer, nullable=False, server_default="1")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
