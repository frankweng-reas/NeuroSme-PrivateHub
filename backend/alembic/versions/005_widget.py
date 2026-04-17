"""Widget: add widget fields to km_knowledge_bases + widget_sessions table

Revision ID: 005_widget
Revises: 004_kb_model_prompt
Create Date: 2026-04-16
"""
import sqlalchemy as sa
from alembic import op

revision = "005_widget"
down_revision = "004_kb_model_prompt"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── km_knowledge_bases: widget 設定欄位 ──────────────────────────────────
    op.add_column(
        "km_knowledge_bases",
        sa.Column(
            "public_token",
            sa.String(64),
            nullable=True,
            unique=True,
            comment="Widget 公開存取 token（UUID hex）",
        ),
    )
    op.add_column(
        "km_knowledge_bases",
        sa.Column("widget_title", sa.String(100), nullable=True, comment="Widget 顯示名稱"),
    )
    op.add_column(
        "km_knowledge_bases",
        sa.Column("widget_logo_url", sa.String(500), nullable=True, comment="Widget logo 圖片 URL"),
    )
    op.add_column(
        "km_knowledge_bases",
        sa.Column(
            "widget_color",
            sa.String(20),
            nullable=True,
            server_default="#1A3A52",
            comment="Widget 主色（hex）",
        ),
    )
    op.add_column(
        "km_knowledge_bases",
        sa.Column(
            "widget_lang",
            sa.String(10),
            nullable=True,
            server_default="zh-TW",
            comment="Widget 預設語言",
        ),
    )
    op.create_index("ix_km_knowledge_bases_public_token", "km_knowledge_bases", ["public_token"])

    # ── widget_sessions 表 ───────────────────────────────────────────────────
    op.create_table(
        "widget_sessions",
        sa.Column("id", sa.String(64), primary_key=True, comment="Session UUID（前端 localStorage）"),
        sa.Column(
            "kb_id",
            sa.Integer,
            sa.ForeignKey("km_knowledge_bases.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("visitor_name", sa.String(100), nullable=True),
        sa.Column("visitor_email", sa.String(200), nullable=True),
        sa.Column("visitor_phone", sa.String(50), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_active_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("widget_sessions")
    op.drop_index("ix_km_knowledge_bases_public_token", table_name="km_knowledge_bases")
    op.drop_column("km_knowledge_bases", "widget_lang")
    op.drop_column("km_knowledge_bases", "widget_color")
    op.drop_column("km_knowledge_bases", "widget_logo_url")
    op.drop_column("km_knowledge_bases", "widget_title")
    op.drop_column("km_knowledge_bases", "public_token")
