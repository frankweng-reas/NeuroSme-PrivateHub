"""新增 notebooks、stored_files、chat_message_attachments、notebook_sources（統一上傳與 Notebook 來源）

Revision ID: 007
Revises: 006
Create Date: 2026-04-07
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notebooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=True),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("extra", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notebooks_tenant_id", "notebooks", ["tenant_id"])
    op.create_index("ix_notebooks_user_id", "notebooks", ["user_id"])
    op.create_index("ix_notebooks_tenant_user", "notebooks", ["tenant_id", "user_id"])

    op.create_table(
        "stored_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=True),
        sa.Column("storage_backend", sa.String(32), nullable=False, server_default="local"),
        sa.Column("storage_rel_path", sa.Text(), nullable=False),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256_hex", sa.CHAR(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("size_bytes >= 0", name="ck_stored_files_size_bytes_nonnegative"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_rel_path", name="uq_stored_files_storage_rel_path"),
    )
    op.create_index("ix_stored_files_tenant_id", "stored_files", ["tenant_id"])
    op.create_index("ix_stored_files_uploaded_by_user_id", "stored_files", ["uploaded_by_user_id"])
    op.create_index("ix_stored_files_tenant_created", "stored_files", ["tenant_id", "created_at"])

    op.create_table(
        "chat_message_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["file_id"], ["stored_files.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "file_id", name="uq_chat_message_attachments_message_file"),
    )
    op.create_index("ix_chat_message_attachments_message_id", "chat_message_attachments", ["message_id"])
    op.create_index("ix_chat_message_attachments_file_id", "chat_message_attachments", ["file_id"])

    op.create_table(
        "notebook_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["notebook_id"], ["notebooks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["file_id"], ["stored_files.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("notebook_id", "file_id", name="uq_notebook_sources_notebook_file"),
    )
    op.create_index("ix_notebook_sources_notebook_id", "notebook_sources", ["notebook_id"])
    op.create_index("ix_notebook_sources_file_id", "notebook_sources", ["file_id"])


def downgrade() -> None:
    op.drop_index("ix_notebook_sources_file_id", table_name="notebook_sources")
    op.drop_index("ix_notebook_sources_notebook_id", table_name="notebook_sources")
    op.drop_table("notebook_sources")
    op.drop_index("ix_chat_message_attachments_file_id", table_name="chat_message_attachments")
    op.drop_index("ix_chat_message_attachments_message_id", table_name="chat_message_attachments")
    op.drop_table("chat_message_attachments")
    op.drop_index("ix_stored_files_tenant_created", table_name="stored_files")
    op.drop_index("ix_stored_files_uploaded_by_user_id", table_name="stored_files")
    op.drop_index("ix_stored_files_tenant_id", table_name="stored_files")
    op.drop_table("stored_files")
    op.drop_index("ix_notebooks_tenant_user", table_name="notebooks")
    op.drop_index("ix_notebooks_user_id", table_name="notebooks")
    op.drop_index("ix_notebooks_tenant_id", table_name="notebooks")
    op.drop_table("notebooks")
