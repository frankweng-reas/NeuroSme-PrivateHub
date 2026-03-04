"""遷移：user_agents FK 改為參照 agent_catalog（為日後 drop agents 做準備）

目前：user_agents (tenant_id, agent_id) FK -> agents(tenant_id, id)
調整後：user_agents agent_id FK -> agent_catalog(id)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. 移除 FK (tenant_id, agent_id) -> agents(tenant_id, id)
    conn.execute(sa.text("ALTER TABLE user_agents DROP CONSTRAINT IF EXISTS fk_user_agents_agent"))

    # 2. 新增 FK agent_id -> agent_catalog(id)
    conn.execute(sa.text("""
        ALTER TABLE user_agents
        ADD CONSTRAINT fk_user_agents_agent_catalog
        FOREIGN KEY (agent_id)
        REFERENCES agent_catalog(id)
        ON DELETE CASCADE
    """))


def downgrade() -> None:
    conn = op.get_bind()

    # 1. 移除 FK agent_id -> agent_catalog(id)
    conn.execute(sa.text("ALTER TABLE user_agents DROP CONSTRAINT IF EXISTS fk_user_agents_agent_catalog"))

    # 2. 還原 FK (tenant_id, agent_id) -> agents(tenant_id, id)
    conn.execute(sa.text("""
        ALTER TABLE user_agents
        ADD CONSTRAINT fk_user_agents_agent
        FOREIGN KEY (tenant_id, agent_id)
        REFERENCES agents(tenant_id, id)
        ON DELETE CASCADE
    """))
