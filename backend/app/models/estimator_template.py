"""EstimatorTemplate：使用者自訂試算情境範本"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class EstimatorTemplate(Base):
    __tablename__ = "estimator_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    # schema: { fields: [{key, label, unit, type}], outputs: [{key, label, formula}] }
    schema = Column("schema_json", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
