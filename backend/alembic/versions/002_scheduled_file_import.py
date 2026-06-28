"""新增 scheduled_file_imports 表（通用排程檔案匯入設定）

Revision ID: 002_scheduled_file_import
Revises: 001_embedding_dim_1024
Create Date: 2026-06-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "002_scheduled_file_import"
down_revision = "001_embedding_dim_1024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scheduled_file_imports",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.String(100), nullable=False),
        sa.Column("target_type", sa.String(50), nullable=False),
        sa.Column("target_id", sa.String(100), nullable=False),
        sa.Column("watch_path", sa.Text(), nullable=False),
        sa.Column("mode", sa.String(20), server_default="replace", nullable=False),
        sa.Column("interval_minutes", sa.Integer(), server_default="60", nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("last_import_status", sa.String(20), server_default="never", nullable=False),
        sa.Column("last_import_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_import_rows", sa.Integer(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("handler_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("target_type", "target_id", name="uq_sfi_target"),
    )
    op.create_index("ix_sfi_tenant_id", "scheduled_file_imports", ["tenant_id"])
    op.create_index("ix_sfi_agent_id",  "scheduled_file_imports", ["agent_id"])


def downgrade() -> None:
    op.drop_index("ix_sfi_agent_id",  table_name="scheduled_file_imports")
    op.drop_index("ix_sfi_tenant_id", table_name="scheduled_file_imports")
    op.drop_table("scheduled_file_imports")
