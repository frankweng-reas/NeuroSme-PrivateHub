"""遷移：agents PK 改為 (tenant_id, id)，user_agents PK 改為 (tenant_id, user_id, agent_id)

邏輯：每個 tenant 有自己的 agents，數目與 is_purchased 皆可不同。

Revision ID: 013
Revises: 012
Create Date: 2025-03-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. user_agents: 先移除 FK agent_id -> agents.id
    # PostgreSQL 預設 FK 名稱
    conn.execute(sa.text("""
        ALTER TABLE user_agents
        DROP CONSTRAINT IF EXISTS user_agents_agent_id_fkey
    """))

    # 2. user_agents: 移除舊 PK
    conn.execute(sa.text("ALTER TABLE user_agents DROP CONSTRAINT IF EXISTS user_agents_pkey"))

    # 3. agents: 改為 composite PK (tenant_id, id)
    conn.execute(sa.text("ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_pkey"))
    conn.execute(sa.text("ALTER TABLE agents ADD PRIMARY KEY (tenant_id, id)"))

    # 4. user_agents: 新增 composite PK (tenant_id, user_id, agent_id)
    conn.execute(sa.text(
        "ALTER TABLE user_agents ADD PRIMARY KEY (tenant_id, user_id, agent_id)"
    ))

    # 5. user_agents: 新增 composite FK (tenant_id, agent_id) -> agents(tenant_id, id)
    conn.execute(sa.text("""
        ALTER TABLE user_agents
        ADD CONSTRAINT fk_user_agents_agent
        FOREIGN KEY (tenant_id, agent_id)
        REFERENCES agents(tenant_id, id)
        ON DELETE CASCADE
    """))


def downgrade() -> None:
    conn = op.get_bind()

    # 1. user_agents: 移除 composite FK
    conn.execute(sa.text(
        "ALTER TABLE user_agents DROP CONSTRAINT IF EXISTS fk_user_agents_agent"
    ))

    # 2. user_agents: 移除 composite PK
    conn.execute(sa.text("ALTER TABLE user_agents DROP CONSTRAINT IF EXISTS user_agents_pkey"))

    # 3. user_agents: 還原 PK (user_id, agent_id)
    conn.execute(sa.text(
        "ALTER TABLE user_agents ADD PRIMARY KEY (user_id, agent_id)"
    ))

    # 4. agents: 移除 composite PK
    conn.execute(sa.text("ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_pkey"))

    # 5. agents: 還原 PK (id)
    conn.execute(sa.text("ALTER TABLE agents ADD PRIMARY KEY (id)"))

    # 6. user_agents: 還原 FK agent_id -> agents.id
    conn.execute(sa.text("""
        ALTER TABLE user_agents
        ADD CONSTRAINT user_agents_agent_id_fkey
        FOREIGN KEY (agent_id)
        REFERENCES agents(id)
        ON DELETE CASCADE
    """))
