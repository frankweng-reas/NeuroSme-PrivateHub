"""033_drop_ordering_sessions

Revision ID: 033
Revises: 032
Create Date: 2026-05-20

移除點餐 API：刪除 ordering_sessions 表
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index("ix_ordering_sessions_api_key_id", table_name="ordering_sessions")
    op.drop_index("ix_ordering_sessions_session_id", table_name="ordering_sessions")
    op.drop_table("ordering_sessions")


def downgrade():
    op.create_table(
        "ordering_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.String(255), nullable=False),
        sa.Column("api_key_id", sa.Integer(), nullable=False),
        sa.Column("kb_id", sa.Integer(), nullable=False),
        sa.Column("messages", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("session_id", "api_key_id", name="uq_ordering_session_api_key"),
        sa.ForeignKeyConstraint(["api_key_id"], ["api_keys.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_ordering_sessions_session_id", "ordering_sessions", ["session_id"])
    op.create_index("ix_ordering_sessions_api_key_id", "ordering_sessions", ["api_key_id"])
