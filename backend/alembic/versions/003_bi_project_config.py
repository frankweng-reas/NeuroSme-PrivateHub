"""bi_projects 加 project_config JSONB 欄位（per-project AI 設定與範例問題）

Revision ID: 003_bi_project_config
Revises: 002_scheduled_file_import
Create Date: 2026-06-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "003_bi_project_config"
down_revision = "002_scheduled_file_import"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bi_projects",
        sa.Column("project_config", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bi_projects", "project_config")
