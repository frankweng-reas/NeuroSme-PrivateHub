from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base


class DocParseResult(Base):
    """Document Parse 解析結果。

    每次解析完成後自動儲存，供前端查閱歷史紀錄。

    result_json  → _format_sections 輸出（list of sections）
    usage_json   → {"prompt_tokens": int, "completion_tokens": int, "total_tokens": int}
    """

    __tablename__ = "doc_parse_results"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id   = Column(String, nullable=True, index=True)
    profile_id  = Column(String(80), nullable=False, index=True)
    profile_name = Column(String(200), nullable=False)
    file_name   = Column(String(500), nullable=False)
    page_count  = Column(Integer, nullable=True)
    model       = Column(String(200), nullable=False, default="")
    result_json = Column(JSONB, nullable=False)          # list[section]
    usage_json  = Column(JSONB, nullable=True)           # token usage
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
