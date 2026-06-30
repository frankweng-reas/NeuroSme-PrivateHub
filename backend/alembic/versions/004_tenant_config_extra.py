"""tenant_configs 加 extra JSONB 欄位（彈性 flag 儲存，避免頻繁改 schema）

Revision ID: 004_tenant_config_extra
Revises: 003_bi_project_config
Create Date: 2026-06-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "004_tenant_config_extra"
down_revision = "003_bi_project_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenant_configs",
        sa.Column(
            "extra",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("tenant_configs", "extra")
