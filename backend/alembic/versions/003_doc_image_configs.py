"""003_doc_image_configs — 圖片→結構化MD 設定與歷史表

Revision ID: 003_doc_image_configs
Revises: 002_estimator_templates
Create Date: 2026-06-12
"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from alembic import op

revision = "003_doc_image_configs"
down_revision = "002_estimator_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "doc_image_configs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(100), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("model", sa.String(200), nullable=False, server_default=""),
        sa.Column("extraction_topics", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "doc_image_history",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("config_id", sa.Integer, sa.ForeignKey("doc_image_configs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("tenant_id", sa.String(100), nullable=False, index=True),
        sa.Column("user_id", sa.Integer, nullable=True),
        sa.Column("filename", sa.String(500), nullable=False, server_default=""),
        sa.Column("raw_text", sa.Text, nullable=False, server_default=""),
        sa.Column("result_markdown", sa.Text, nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="success"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("model", sa.String(200), nullable=True),
        sa.Column("prompt_tokens", sa.Integer, nullable=True),
        sa.Column("completion_tokens", sa.Integer, nullable=True),
        sa.Column("total_tokens", sa.Integer, nullable=True),
        sa.Column("latency_ms", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("doc_image_history")
    op.drop_table("doc_image_configs")
