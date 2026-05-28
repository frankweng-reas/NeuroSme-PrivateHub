"""032_bot_access_mode

Revision ID: 032
Revises: 031
Create Date: 2026-05-19

km_bots：新增 access_mode 欄位
  public        → 任何人可用（現行預設）
  authenticated → 需 LocalAuth JWT 驗證（內部限定）
"""
from alembic import op
import sqlalchemy as sa

revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "km_bots",
        sa.Column("access_mode", sa.String(20), nullable=False, server_default="public"),
    )


def downgrade():
    op.drop_column("km_bots", "access_mode")
