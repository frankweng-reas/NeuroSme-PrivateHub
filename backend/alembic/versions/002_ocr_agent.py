"""add ocr_agent_configs and ocr_extraction_history tables

Revision ID: 002_ocr_agent
Revises: 001_audio_seconds
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '002_ocr_agent'
down_revision = '001_audio_seconds'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'ocr_agent_configs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('tenant_id', sa.String(100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('data_type_label', sa.String(100), nullable=False, server_default=''),
        sa.Column('model', sa.String(200), nullable=False, server_default=''),
        sa.Column('output_fields', JSONB(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ocr_agent_configs_tenant_id', 'ocr_agent_configs', ['tenant_id'])

    op.create_table(
        'ocr_extraction_history',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('config_id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.String(100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('filename', sa.String(500), nullable=False, server_default=''),
        sa.Column('raw_text', sa.Text(), nullable=False, server_default=''),
        sa.Column('extracted_fields', JSONB(), nullable=False, server_default='{}'),
        sa.Column('status', sa.String(20), nullable=False, server_default='success'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['config_id'], ['ocr_agent_configs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ocr_extraction_history_config_id', 'ocr_extraction_history', ['config_id'])
    op.create_index('ix_ocr_extraction_history_tenant_id', 'ocr_extraction_history', ['tenant_id'])


def downgrade() -> None:
    op.drop_table('ocr_extraction_history')
    op.drop_table('ocr_agent_configs')
