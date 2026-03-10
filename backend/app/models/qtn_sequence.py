"""QtnSequence ORM：對應 qtn_sequence 表（報價單號序號）"""
from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class QtnSequence(Base):
    __tablename__ = "qtn_sequence"

    year = Column(Integer, primary_key=True)
    tenant_id = Column(String(100), ForeignKey("tenants.id", ondelete="RESTRICT"), primary_key=True, index=True)
    last_seq = Column(Integer, nullable=False, default=0)
