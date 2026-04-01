"""agent_catalog: drop id column, promote agent_id to primary key.

Revision ID: 002
Revises: 001
Create Date: 2026-04-01
"""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Drop FK constraints that reference agent_catalog(agent_id)
    #    (they will be re-added after agent_id becomes the PK)
    conn.execute(sa.text(
        "ALTER TABLE user_agents  DROP CONSTRAINT IF EXISTS fk_user_agents_agent_catalog_semantic"
    ))
    conn.execute(sa.text(
        "ALTER TABLE tenant_agents DROP CONSTRAINT IF EXISTS fk_tenant_agents_agent_catalog_semantic"
    ))

    # 2. Drop the unique constraint on agent_id (will be implied by PK)
    conn.execute(sa.text(
        "ALTER TABLE agent_catalog DROP CONSTRAINT IF EXISTS uq_agent_catalog_agent_id"
    ))

    # 3. Drop the old primary key (on id) and the id column
    conn.execute(sa.text("ALTER TABLE agent_catalog DROP CONSTRAINT agent_catalog_pkey"))
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_agent_catalog_id"))
    op.drop_column("agent_catalog", "id")

    # 4. Promote agent_id to primary key
    conn.execute(sa.text("ALTER TABLE agent_catalog ADD PRIMARY KEY (agent_id)"))

    # 5. Re-add FK constraints (now reference the new PK)
    conn.execute(sa.text("""
        ALTER TABLE tenant_agents
        ADD CONSTRAINT fk_tenant_agents_agent_catalog_semantic
        FOREIGN KEY (agent_id) REFERENCES agent_catalog(agent_id) ON DELETE CASCADE
    """))
    conn.execute(sa.text("""
        ALTER TABLE user_agents
        ADD CONSTRAINT fk_user_agents_agent_catalog_semantic
        FOREIGN KEY (agent_id) REFERENCES agent_catalog(agent_id) ON DELETE CASCADE
    """))


def downgrade() -> None:
    raise NotImplementedError("Downgrade not supported for this migration.")
