"""遷移：新增 agent_catalog、tenant_agents 表

agent_catalog：系統全域 agent 定義（id PK，無 tenant_id）
tenant_agents：客戶買了哪些 agent（tenant_id, agent_id）
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. agent_catalog：系統全域 agent 定義
    op.create_table(
        "agent_catalog",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("group_id", sa.String(100), nullable=False, index=True),
        sa.Column("group_name", sa.String(255), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False, index=True),
        sa.Column("agent_name", sa.String(255), nullable=False),
        sa.Column("icon_name", sa.String(100), nullable=True),
    )

    # 2. tenant_agents：客戶買了哪些 agent
    op.create_table(
        "tenant_agents",
        sa.Column("tenant_id", sa.String(100), sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("agent_id", sa.String(100), sa.ForeignKey("agent_catalog.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_tenant_agents_tenant_id", "tenant_agents", ["tenant_id"], unique=False)
    op.create_index("ix_tenant_agents_agent_id", "tenant_agents", ["agent_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_tenant_agents_agent_id", table_name="tenant_agents")
    op.drop_index("ix_tenant_agents_tenant_id", table_name="tenant_agents")
    op.drop_table("tenant_agents")
    op.drop_table("agent_catalog")
