"""BotQueryLog：Bot 查詢記錄，供零命中統計與 Bot 品質分析使用

來源區分：
  Widget 呼叫  → session_id 有值，api_key_id / external_user_fk 為 NULL
  Public API   → api_key_id 有值，session_id 為 NULL；
                 若 caller 有傳使用者資訊，external_user_fk 指向 bot_external_users
"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class BotQueryLog(Base):
    __tablename__ = "bot_query_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    bot_id = Column(Integer, ForeignKey("km_bots.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(
        String(64),
        ForeignKey("bot_widget_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    api_key_id = Column(
        Integer,
        ForeignKey("api_keys.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Public API 呼叫時記錄使用的 API Key；Widget 呼叫為 NULL",
    )
    external_user_fk = Column(
        UUID(as_uuid=True),
        ForeignKey("bot_external_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="外部使用者 FK；無使用者資訊時為 NULL",
    )
    query = Column(Text, nullable=False)
    hit = Column(Boolean, nullable=False, server_default="false", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
