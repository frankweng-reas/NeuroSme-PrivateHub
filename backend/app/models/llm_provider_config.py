"""LLMProviderConfig ORM：對應 llm_provider_configs 表，儲存各租戶 LLM provider 的 API Key 與預設設定"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base


class LLMProviderConfig(Base):
    __tablename__ = "llm_provider_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    provider = Column(String(50), nullable=False, index=True)      # openai | gemini | twcc
    label = Column(String(255), nullable=True)                     # 顯示名稱，例：OpenAI（公司帳號）
    api_key_encrypted = Column(Text, nullable=True)                # Fernet 加密後的 API Key
    api_base_url = Column(Text, nullable=True)                     # 台智雲等需要自訂 base URL
    default_model = Column(String(255), nullable=True)             # 預設模型，例：gpt-4o-mini
    available_models = Column(JSONB, nullable=True)                # 可選模型清單（JSON array of strings）
    is_active = Column(Boolean, nullable=False, server_default="true", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
