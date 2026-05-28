"""035 create doc_parse_results table

Revision ID: 035
Revises: 034
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "doc_parse_results",
        sa.Column("id",           sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column("user_id",      sa.Integer(),     sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id",    sa.String(),      nullable=True),
        sa.Column("profile_id",   sa.String(80),    nullable=False),
        sa.Column("profile_name", sa.String(200),   nullable=False),
        sa.Column("file_name",    sa.String(500),   nullable=False),
        sa.Column("page_count",   sa.Integer(),     nullable=True),
        sa.Column("model",        sa.String(200),   nullable=False, server_default=""),
        sa.Column("result_json",  JSONB(),          nullable=False),
        sa.Column("usage_json",   JSONB(),          nullable=True),
        sa.Column("created_at",   sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_doc_parse_results_user_id",   "doc_parse_results", ["user_id"])
    op.create_index("ix_doc_parse_results_tenant_id",  "doc_parse_results", ["tenant_id"])
    op.create_index("ix_doc_parse_results_profile_id", "doc_parse_results", ["profile_id"])
    op.create_index("ix_doc_parse_results_created_at", "doc_parse_results", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_doc_parse_results_created_at", "doc_parse_results")
    op.drop_index("ix_doc_parse_results_profile_id",  "doc_parse_results")
    op.drop_index("ix_doc_parse_results_tenant_id",   "doc_parse_results")
    op.drop_index("ix_doc_parse_results_user_id",     "doc_parse_results")
    op.drop_table("doc_parse_results")
