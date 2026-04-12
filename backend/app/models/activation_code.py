"""ActivationCode ORM：對應 activation_codes 表，儲存授權碼記錄"""
from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text

from app.core.database import Base


class ActivationCode(Base):
    __tablename__ = "activation_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code_hash = Column(Text, nullable=False, unique=True, index=True)
    customer_name = Column(String(255), nullable=False)
    agent_ids = Column(Text, nullable=False)
    expires_at = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    activated_at = Column(DateTime(timezone=True), nullable=True)
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True)

    @property
    def agent_ids_list(self) -> list[str]:
        return [a.strip() for a in self.agent_ids.split(",") if a.strip()]

    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        return date.today() > self.expires_at
