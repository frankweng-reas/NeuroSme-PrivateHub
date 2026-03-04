"""遷移：drop agents 表（已由 agent_catalog + tenant_agents 取代）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("agents")


def downgrade() -> None:
    # 還原 agents 表結構（簡化版，不含既有資料）
    op.create_table(
        "agents",
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("id", sa.String(100), nullable=False),
        sa.Column("group_id", sa.String(100), nullable=False),
        sa.Column("group_name", sa.String(255), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("agent_name", sa.String(255), nullable=False),
        sa.Column("icon_name", sa.String(100), nullable=True),
        sa.Column("is_purchased", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.PrimaryKeyConstraint("tenant_id", "id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_agents_tenant_id", "agents", ["tenant_id"], unique=False)
    op.create_index("ix_agents_group_id", "agents", ["group_id"], unique=False)
    op.create_index("ix_agents_agent_id", "agents", ["agent_id"], unique=False)
