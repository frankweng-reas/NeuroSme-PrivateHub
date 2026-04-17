"""006_widget_logo_text: widget_logo_url 改為 Text（存 base64）

Revision ID: 006_widget_logo_text
Revises: 005_widget
Create Date: 2026-04-17
"""

from alembic import op
import sqlalchemy as sa

revision = "006_widget_logo_text"
down_revision = "005_widget"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "km_knowledge_bases",
        "widget_logo_url",
        type_=sa.Text(),
        comment="Widget logo（base64 data URL 或外部圖片 URL）",
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "km_knowledge_bases",
        "widget_logo_url",
        type_=sa.String(500),
        comment="Widget logo 圖片 URL",
        existing_nullable=True,
    )
