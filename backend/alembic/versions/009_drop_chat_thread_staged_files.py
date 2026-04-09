"""drop chat_thread_staged_files（改為訊息送出行再綁 message）

Revision ID: 009
Revises: 008
Create Date: 2026-04-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_chat_thread_staged_files_file_id", table_name="chat_thread_staged_files")
    op.drop_index("ix_chat_thread_staged_files_thread_id", table_name="chat_thread_staged_files")
    op.drop_table("chat_thread_staged_files")


def downgrade() -> None:
    op.create_table(
        "chat_thread_staged_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["thread_id"], ["chat_threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["file_id"], ["stored_files.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("thread_id", "file_id", name="uq_chat_thread_staged_thread_file"),
    )
    op.create_index("ix_chat_thread_staged_files_thread_id", "chat_thread_staged_files", ["thread_id"])
    op.create_index("ix_chat_thread_staged_files_file_id", "chat_thread_staged_files", ["file_id"])
