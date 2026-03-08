"""遷移：建立 qtn_projects、qtn_sources 表（報價專案與來源檔案）

qtn_projects：報價專案，每個 user 可建立多個專案
qtn_sources：每個專案用到的上傳檔案與內容
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. qtn_projects：報價專案
    op.create_table(
        "qtn_projects",
        sa.Column("project_id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.String(100), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("user_id", sa.String(100), nullable=False, index=True),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column("project_name", sa.String(255), nullable=False),
        sa.Column("project_desc", sa.Text(), nullable=True),
        sa.Column("qtn_draft", JSONB(), nullable=True),
        sa.Column("qtn_final", JSONB(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="PARSING"),
        sa.Column("total_amount", sa.Numeric(precision=15, scale=2), nullable=True),
        sa.Column("currency", sa.String(10), nullable=True, server_default="TWD"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # 2. qtn_sources：專案用到的上傳檔案與內容
    op.create_table(
        "qtn_sources",
        sa.Column("source_id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("qtn_projects.project_id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("context", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("qtn_sources")
    op.drop_table("qtn_projects")
