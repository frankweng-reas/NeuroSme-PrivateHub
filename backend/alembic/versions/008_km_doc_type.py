"""008_km_doc_type

km_documents 加 doc_type 欄位（文件類型，影響 chunking 策略）

Revision ID: 008_km_doc_type
Revises: 007_widget_messages
Create Date: 2026-04-17
"""
from alembic import op
import sqlalchemy as sa

revision = "008_km_doc_type"
down_revision = "007_widget_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "km_documents",
        sa.Column(
            "doc_type",
            sa.String(32),
            nullable=False,
            server_default="article",
            comment="article | policy | spec | faq",
        ),
    )


def downgrade() -> None:
    op.drop_column("km_documents", "doc_type")
