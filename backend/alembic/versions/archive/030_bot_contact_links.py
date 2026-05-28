"""030_bot_contact_links

Revision ID: 030
Revises: 029
Create Date: 2026-05-19

km_bots：新增聯絡資訊功能
  - contact_enabled：開關
  - contact_links：JSON 陣列，每筆含 type / label / value
"""
from alembic import op
import sqlalchemy as sa

revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "km_bots",
        sa.Column("contact_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "km_bots",
        sa.Column("contact_links", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("km_bots", "contact_links")
    op.drop_column("km_bots", "contact_enabled")
