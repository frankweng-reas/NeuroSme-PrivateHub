from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text, func

from app.core.database import Base


class DocParseEvaluation(Base):
    """投標評估項目。

    一筆 parse result 可對應多筆 evaluation，
    item_type 區分「應備文件」(doc_checklist) 與「技術規範矩陣」(tech_matrix)。
    """

    __tablename__ = "doc_parse_evaluation"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    result_id  = Column(Integer, ForeignKey("doc_parse_results.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    item_type  = Column(String(20),  nullable=False)   # "doc_checklist" | "tech_matrix"
    item_key   = Column(String(500), nullable=False)   # 文件名稱 or 規格描述
    cite       = Column(Text,        nullable=True)    # 原文依據
    sort_order = Column(Integer,     nullable=False, default=0)

    # ── doc_checklist ──────────────────────────────────────────────────
    mandatory  = Column(Boolean,     nullable=True)    # True=必附 False=選附 None=待分類
    assignee   = Column(String(200), nullable=True)
    due_date   = Column(Date,        nullable=True)
    status     = Column(String(20),  nullable=True, default="todo")

    # ── tech_matrix ────────────────────────────────────────────────────
    capability = Column(String(20),  nullable=True)    # meet|custom|outsource|unknown
    risk_level = Column(String(10),  nullable=True)    # high|medium|low

    # ── 共用 ────────────────────────────────────────────────────────────
    note       = Column(Text,        nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)
