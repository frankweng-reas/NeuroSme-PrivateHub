"""UserSchemaMapping ORM：使用者對 schema 的 mapping 範本（長存）"""
from sqlalchemy import Column, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.types import DateTime

from app.core.database import Base


class UserSchemaMapping(Base):
    """user_id + schema_id + template_name 唯一，支援多來源（91app、momo、pchome 等）"""
    __tablename__ = "user_schema_mappings"
    __table_args__ = (UniqueConstraint("user_id", "schema_id", "template_name", name="uq_user_schema_template"),)

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    schema_id = Column(String(100), nullable=False, index=True)  # e.g. bi_sales_table
    template_name = Column(String(255), nullable=False, index=True)  # e.g. 91app銷售報表
    mapping = Column(Text, nullable=False)  # JSON: { schema_field: csv_header }
    csv_headers = Column(Text, nullable=True)  # JSON: ["col1","col2"] 用於 auto-match
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
