"""029_bot_faq_type

Revision ID: 029
Revises: 028
Create Date: 2026-05-19

拆分 FAQ 為 熱門FAQ（popular）/ 常見FAQ（common）：
  - km_bot_faqs：新增 faq_type 欄位（'popular' | 'common'，預設 'common'）
  - km_bots：
      faq_enabled  → rename → common_faq_enabled
      新增 popular_faq_enabled
"""
from alembic import op
import sqlalchemy as sa

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def upgrade():
    # km_bot_faqs：加 faq_type
    op.add_column(
        "km_bot_faqs",
        sa.Column("faq_type", sa.String(20), nullable=False, server_default="common"),
    )
    op.create_index("ix_km_bot_faqs_faq_type", "km_bot_faqs", ["faq_type"])

    # km_bots：rename faq_enabled → common_faq_enabled
    op.alter_column("km_bots", "faq_enabled", new_column_name="common_faq_enabled")

    # km_bots：加 popular_faq_enabled
    op.add_column(
        "km_bots",
        sa.Column("popular_faq_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade():
    op.drop_column("km_bots", "popular_faq_enabled")
    op.alter_column("km_bots", "common_faq_enabled", new_column_name="faq_enabled")
    op.drop_index("ix_km_bot_faqs_faq_type", table_name="km_bot_faqs")
    op.drop_column("km_bot_faqs", "faq_type")
