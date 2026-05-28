"""048_remove_marketing_agent

Revision ID: 048
Revises: 047
Create Date: 2026-05-27

移除 Marketing Agent（功能已整合至 Writing Agent + Skills）
"""
from alembic import op

revision = '048'
down_revision = '047'
branch_labels = None
depends_on = None

_AGENT_ID = 'marketing'


def upgrade() -> None:
    op.execute(f"DELETE FROM user_agents WHERE agent_id = '{_AGENT_ID}'")
    op.execute(f"DELETE FROM tenant_agents WHERE agent_id = '{_AGENT_ID}'")
    op.execute(f"DELETE FROM agent_catalog WHERE agent_id = '{_AGENT_ID}'")


def downgrade() -> None:
    op.execute(
        f"""
        INSERT INTO agent_catalog (
            agent_id, group_id, group_name, agent_name,
            icon_name, sort_id, backend_router, frontend_key
        ) VALUES (
            '{_AGENT_ID}', 'marketing', '行銷', 'Marketing Writer',
            'Megaphone', '16', NULL, 'agent-marketing'
        )
        ON CONFLICT (agent_id) DO NOTHING
        """
    )
