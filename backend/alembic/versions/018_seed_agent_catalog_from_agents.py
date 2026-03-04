"""遷移：從 agents 匯入資料到 agent_catalog、tenant_agents"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. agent_catalog：從 agents 取不重複的 agent（每個 id 一筆）
    conn.execute(
        sa.text("""
            INSERT INTO agent_catalog (id, group_id, group_name, agent_id, agent_name, icon_name)
            SELECT DISTINCT ON (id) id, group_id, group_name, agent_id, agent_name, icon_name
            FROM agents
            ORDER BY id
        """)
    )

    # 2. tenant_agents：從 agents 取 is_purchased=true 的 (tenant_id, id)
    conn.execute(
        sa.text("""
            INSERT INTO tenant_agents (tenant_id, agent_id)
            SELECT tenant_id, id
            FROM agents
            WHERE is_purchased = true
            ON CONFLICT (tenant_id, agent_id) DO NOTHING
        """)
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM tenant_agents"))
    conn.execute(sa.text("DELETE FROM agent_catalog"))
