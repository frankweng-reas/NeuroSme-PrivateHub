"""create agent_usage_logs table

Revision ID: 004_agent_usage_log
Revises: 003_ocr_usage
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa

revision = '004_agent_usage_log'
down_revision = '003_ocr_usage'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'agent_usage_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('agent_type', sa.String(50), nullable=False),
        sa.Column('tenant_id', sa.String(100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('model', sa.String(200), nullable=True),
        sa.Column('prompt_tokens', sa.Integer(), nullable=True),
        sa.Column('completion_tokens', sa.Integer(), nullable=True),
        sa.Column('total_tokens', sa.Integer(), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='success'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_agent_usage_logs_agent_type', 'agent_usage_logs', ['agent_type'])
    op.create_index('ix_agent_usage_logs_tenant_id', 'agent_usage_logs', ['tenant_id'])
    op.create_index('ix_agent_usage_logs_created_at', 'agent_usage_logs', ['created_at'])


def downgrade() -> None:
    op.drop_table('agent_usage_logs')
