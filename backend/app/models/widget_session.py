from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class WidgetSession(Base):
    __tablename__ = "widget_sessions"

    id = Column(String(64), primary_key=True, comment="Session UUID（前端 localStorage）")
    kb_id = Column(Integer, ForeignKey("km_knowledge_bases.id", ondelete="CASCADE"), nullable=False, index=True)
    visitor_name = Column(String(100), nullable=True)
    visitor_email = Column(String(200), nullable=True)
    visitor_phone = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_active_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    knowledge_base = relationship("KmKnowledgeBase", back_populates="widget_sessions")
    messages = relationship("WidgetMessage", back_populates="session", order_by="WidgetMessage.created_at", cascade="all, delete-orphan")
