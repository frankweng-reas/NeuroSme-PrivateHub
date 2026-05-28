"""031_drop_home_links

Revision ID: 031
Revises: 030
Create Date: 2026-05-19

km_bots：移除 home_links 欄位（功能由 contact_links 統一處理）
"""
from alembic import op

revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("km_bots", "home_links")


def downgrade():
    import sqlalchemy as sa
    op.add_column("km_bots", sa.Column("home_links", sa.Text(), nullable=True))
