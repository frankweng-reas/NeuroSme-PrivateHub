"""遷移：新增 prompt_templates 表

Revision ID: 016
Revises: 015
Create Date: 2025-03-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "prompt_templates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("tenant_id", sa.String(100), sa.ForeignKey("tenants.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_prompt_templates_user_tenant_agent",
        "prompt_templates",
        ["user_id", "tenant_id", "agent_id"],
        unique=False,
    )
    op.create_unique_constraint(
        "uq_prompt_templates_user_tenant_agent_name",
        "prompt_templates",
        ["user_id", "tenant_id", "agent_id", "name"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_prompt_templates_user_tenant_agent_name", "prompt_templates", type_="unique")
    op.drop_index("ix_prompt_templates_user_tenant_agent", table_name="prompt_templates")
    op.drop_table("prompt_templates")
