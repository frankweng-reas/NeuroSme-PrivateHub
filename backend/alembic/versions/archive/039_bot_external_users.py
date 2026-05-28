"""039_bot_external_users

Revision ID: 039
Revises: 038
Create Date: 2026-05-22

新增 bot_external_users 表，記錄透過 Public API 呼叫 Bot 的外部使用者。
external_platform 區分來源：fb / line / custom / localauth（內部驗證）
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '039'
down_revision = '038'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'bot_external_users',
        sa.Column('id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column('tenant_id', sa.String(100),
                  sa.ForeignKey('tenants.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('bot_id', sa.Integer,
                  sa.ForeignKey('km_bots.id', ondelete='CASCADE'), nullable=False),
        sa.Column('external_platform', sa.String(30), nullable=False,
                  comment='fb / line / custom / localauth'),
        sa.Column('external_user_id', sa.String(200), nullable=False,
                  comment='FB PSID、LINE UID、LocalAuth sub 等'),
        sa.Column('display_name', sa.String(200), nullable=True,
                  comment='顯示名稱，由 connector 或 JWT 提供'),
        sa.Column('first_seen_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_bot_external_users_tenant_id', 'bot_external_users', ['tenant_id'])
    op.create_index('ix_bot_external_users_bot_id', 'bot_external_users', ['bot_id'])
    op.create_index('ix_bot_external_users_last_seen_at', 'bot_external_users', ['last_seen_at'])
    # 同一 bot + platform + user 只存一筆
    op.create_unique_constraint(
        'uq_bot_external_users_identity',
        'bot_external_users',
        ['bot_id', 'external_platform', 'external_user_id'],
    )


def downgrade():
    op.drop_index('ix_bot_external_users_last_seen_at', 'bot_external_users')
    op.drop_index('ix_bot_external_users_bot_id', 'bot_external_users')
    op.drop_index('ix_bot_external_users_tenant_id', 'bot_external_users')
    op.drop_constraint('uq_bot_external_users_identity', 'bot_external_users')
    op.drop_table('bot_external_users')
