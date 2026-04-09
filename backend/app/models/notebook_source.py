"""NotebookSource：notebook_sources，Notebook 引用之來源檔"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class NotebookSource(Base):
    __tablename__ = "notebook_sources"
    __table_args__ = (UniqueConstraint("notebook_id", "file_id", name="uq_notebook_sources_notebook_file"),)

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    notebook_id = Column(
        UUID(as_uuid=True),
        ForeignKey("notebooks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_id = Column(
        UUID(as_uuid=True),
        ForeignKey("stored_files.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    sort_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    notebook = relationship("Notebook", back_populates="sources")
    file = relationship("StoredFile", back_populates="notebook_sources")
