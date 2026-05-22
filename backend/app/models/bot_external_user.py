"""BotExternalUser：記錄透過 Public API 呼叫 Bot 的外部使用者

external_platform 區分來源：
  fb        → Facebook Messenger（PSID）
  line      → LINE（UID）
  custom    → 自訂 App
  localauth → 內部系統（LocalAuth JWT sub）
"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class BotExternalUser(Base):
    __tablename__ = "bot_external_users"
    __table_args__ = (
        UniqueConstraint("bot_id", "external_platform", "external_user_id",
                         name="uq_bot_external_users_identity"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"),
                       nullable=False, index=True)
    bot_id = Column(Integer, ForeignKey("km_bots.id", ondelete="CASCADE"),
                    nullable=False, index=True)
    external_platform = Column(String(30), nullable=False,
                               comment="fb / line / custom / localauth")
    external_user_id = Column(String(200), nullable=False,
                              comment="FB PSID、LINE UID、LocalAuth sub 等")
    display_name = Column(String(200), nullable=True,
                          comment="顯示名稱，由 connector 或 JWT 提供")
    first_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
