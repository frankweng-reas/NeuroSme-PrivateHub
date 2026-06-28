"""ScheduledFileImport ORM：對應 scheduled_file_imports 表（通用排程檔案匯入設定）

設計原則：
- 不綁定特定 agent，以 target_type + target_id 通用參照任意 entity
- 排程邏輯由 services/scheduled_file_import_service.py 的 dispatcher 依 target_type 分派
- 無 FK（通用設計），刪除 entity 時由 API 層連動刪除對應紀錄
"""
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base


class ScheduledFileImport(Base):
    __tablename__ = "scheduled_file_imports"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id        = Column(String(100), nullable=False, index=True)   # multi-tenant 隔離
    agent_id         = Column(String(100), nullable=False, index=True)   # 所屬 agent（方便過濾，排程器不需 JOIN）
    user_id          = Column(String(100), nullable=False)               # 建立者（審計用）
    target_type      = Column(String(50),  nullable=False)               # "bi_project" | 未來擴充
    target_id        = Column(String(100), nullable=False)               # project_id 等（UUID string）
    watch_path       = Column(Text, nullable=False)                      # 容器內目錄絕對路徑
    mode             = Column(String(20),  nullable=False, server_default="replace")   # replace / append
    interval_minutes = Column(Integer,     nullable=False, server_default="60")        # 30 / 60 / 1440
    enabled          = Column(Boolean,     nullable=False, server_default="true")
    # never / running / success / failed
    # "running" 防止排程器在同一筆尚未完成時再次觸發（避免併發寫入 DuckDB）
    last_import_status = Column(String(20), nullable=False, server_default="never")
    last_import_at     = Column(DateTime(timezone=True), nullable=True)
    last_import_rows   = Column(Integer, nullable=True)
    last_error         = Column(Text, nullable=True)
    # agent-specific 額外參數，例如：{"file_encoding": "utf-8", "glob_pattern": "*.csv", "file_mtimes": {...}}
    handler_config     = Column(JSONB, nullable=True)
    created_at         = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at         = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        # 一個 entity 只對應一條自動匯入設定
        UniqueConstraint("target_type", "target_id", name="uq_sfi_target"),
    )
