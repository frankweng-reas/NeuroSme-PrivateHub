from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.database import Base


class Bot(Base):
    __tablename__ = "km_bots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    system_prompt = Column(Text, nullable=True)
    fallback_message = Column(Text, nullable=True)
    fallback_message_enabled = Column(Boolean, nullable=False, default=False)
    answer_mode = Column(String(20), nullable=False, default="rag")
    model_name = Column(String(100), nullable=True)

    # Widget / Public API 存取憑證
    public_token = Column(String(64), nullable=True, unique=True, index=True)
    widget_title = Column(String(100), nullable=True)
    widget_logo_url = Column(Text, nullable=True)
    widget_color = Column(String(20), nullable=True, default="#1A3A52")
    widget_lang = Column(String(10), nullable=True, default="zh-TW")
    widget_voice_enabled = Column(Boolean, nullable=False, default=False)
    widget_voice_prompt = Column(Text, nullable=True)

    # 客服情境：首頁面
    home_enabled = Column(Boolean, nullable=False, default=False)
    home_greeting = Column(Text, nullable=True)
    home_quick_questions = Column(Text, nullable=True)   # JSON string[]
    # 客服情境：FAQ（拆為 熱門 / 常見 兩組）
    popular_faq_enabled = Column(Boolean, nullable=False, default=False)
    common_faq_enabled = Column(Boolean, nullable=False, default=False)
    contact_enabled = Column(Boolean, nullable=False, default=False)
    contact_links = Column(Text, nullable=True)              # JSON {type,label,value}[]

    # 存取控制：public | authenticated
    access_mode = Column(String(20), nullable=False, default="public")

    # 訊息平台整合（JSONB，統一存放 fb / line / custom 等設定）
    messaging_integrations = Column(JSONB, nullable=False, server_default="{}")

    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    knowledge_bases = relationship(
        "KmKnowledgeBase",
        secondary="km_bot_kb",
        lazy="joined",
        order_by="BotKnowledgeBase.sort_order",
    )
    faqs = relationship(
        "BotFaq",
        back_populates="bot",
        order_by="BotFaq.sort_order",
        cascade="all, delete-orphan",
    )


class BotKnowledgeBase(Base):
    __tablename__ = "km_bot_kb"

    bot_id = Column(Integer, ForeignKey("km_bots.id", ondelete="CASCADE"), primary_key=True)
    knowledge_base_id = Column(Integer, ForeignKey("km_knowledge_bases.id", ondelete="CASCADE"), primary_key=True)
    sort_order = Column(Integer, nullable=False, default=0)


class BotFaq(Base):
    __tablename__ = "km_bot_faqs"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    bot_id = Column(Integer, ForeignKey("km_bots.id", ondelete="CASCADE"), nullable=False, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    faq_type = Column(String(20), nullable=False, default="common")  # 'popular' | 'common'
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    bot = relationship("Bot", back_populates="faqs")
