from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class WidgetMessage(Base):
    __tablename__ = "widget_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(
        String(64),
        ForeignKey("widget_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role = Column(String(20), nullable=False, comment="user | assistant")
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("WidgetSession", back_populates="messages")
