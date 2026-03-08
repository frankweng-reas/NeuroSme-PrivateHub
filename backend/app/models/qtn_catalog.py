"""QtnCatalog ORM：對應 qtn_catalogs 表（公司產品/服務報價清單）"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class QtnCatalog(Base):
    __tablename__ = "qtn_catalogs"

    catalog_id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True)
    catalog_name = Column(String(255), nullable=False)
    content = Column(Text, nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
