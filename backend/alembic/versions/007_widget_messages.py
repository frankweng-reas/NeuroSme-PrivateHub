"""007_widget_messages

新增 widget_messages 表：儲存 Widget 訪客對話紀錄

Revision ID: 007_widget_messages
Revises: 006_widget_logo_text
Create Date: 2026-04-16
"""
from alembic import op
import sqlalchemy as sa

revision = "007_widget_messages"
down_revision = "006_widget_logo_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "widget_messages",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(64), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, comment="user | assistant"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["widget_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_widget_messages_session_id", "widget_messages", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_widget_messages_session_id", table_name="widget_messages")
    op.drop_table("widget_messages")
