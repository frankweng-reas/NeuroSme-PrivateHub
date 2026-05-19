"""028_bot_cs_features

Revision ID: 028
Revises: 027
Create Date: 2026-05-19

新增兩個客服情境功能：
  - km_bots：home_enabled / home_greeting / home_quick_questions / home_links / faq_enabled
  - km_bot_faqs：FAQ 管理表
"""
from alembic import op
import sqlalchemy as sa

revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade():
    # ── km_bots 新增欄位 ──────────────────────────────────────────────────────
    op.add_column("km_bots", sa.Column("home_enabled", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("km_bots", sa.Column("home_greeting", sa.Text(), nullable=True))
    op.add_column("km_bots", sa.Column("home_quick_questions", sa.Text(), nullable=True))
    op.add_column("km_bots", sa.Column("home_links", sa.Text(), nullable=True))
    op.add_column("km_bots", sa.Column("faq_enabled", sa.Boolean(), nullable=False, server_default="false"))

    # ── km_bot_faqs 新表 ──────────────────────────────────────────────────────
    op.create_table(
        "km_bot_faqs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bot_id", sa.Integer(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["bot_id"], ["km_bots.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_km_bot_faqs_id", "km_bot_faqs", ["id"])
    op.create_index("ix_km_bot_faqs_bot_id", "km_bot_faqs", ["bot_id"])


def downgrade():
    op.drop_index("ix_km_bot_faqs_bot_id", table_name="km_bot_faqs")
    op.drop_index("ix_km_bot_faqs_id", table_name="km_bot_faqs")
    op.drop_table("km_bot_faqs")

    op.drop_column("km_bots", "faq_enabled")
    op.drop_column("km_bots", "home_links")
    op.drop_column("km_bots", "home_quick_questions")
    op.drop_column("km_bots", "home_greeting")
    op.drop_column("km_bots", "home_enabled")
