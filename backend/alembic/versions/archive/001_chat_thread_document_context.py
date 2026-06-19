"""001_chat_thread_document_context — doc-analyst 文件錨點欄位

Revision ID: 001_chat_thread_document_context
Revises: 000_initial_v2
Create Date: 2026-06-03
"""
import sqlalchemy as sa
from alembic import op

revision = "001_chat_thread_document_context"
down_revision = "000_initial_v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_threads", sa.Column("document_context", sa.Text(), nullable=True))
    op.add_column("chat_threads", sa.Column("document_filename", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_threads", "document_filename")
    op.drop_column("chat_threads", "document_context")
