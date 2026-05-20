from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base


class DocParseProfile(Base):
    """Document Parse 解析設定（Profile）。

    definition 欄位存放完整的 JSON 設定（sections / fields），
    格式與 backend/config/parse_profiles/*.json 相同。

    tenant_id = None → 系統內建 Profile，所有租戶可用。
    tenant_id = <id> → 該租戶專屬 Profile。
    """

    __tablename__ = "doc_parse_profiles"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    profile_id  = Column(String(80), nullable=False, unique=True, index=True)
    profile_name = Column(String(200), nullable=False)
    tenant_id   = Column(String, nullable=True, index=True)   # None = 系統共用
    definition  = Column(JSONB, nullable=False)               # sections + fields
    is_active   = Column(Boolean, nullable=False, server_default="true")
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
