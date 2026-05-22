"""040_bot_query_log_external

Revision ID: 040
Revises: 039
Create Date: 2026-05-22

bot_query_logs 新增：
  api_key_id       — 記錄哪把 API Key 呼叫（Widget 呼叫為 NULL）
  external_user_fk — FK 至 bot_external_users（無外部用戶資訊時為 NULL）
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '040'
down_revision = '039'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'bot_query_logs',
        sa.Column('api_key_id', sa.Integer,
                  sa.ForeignKey('api_keys.id', ondelete='SET NULL'),
                  nullable=True),
    )
    op.add_column(
        'bot_query_logs',
        sa.Column('external_user_fk', UUID(as_uuid=True),
                  sa.ForeignKey('bot_external_users.id', ondelete='SET NULL'),
                  nullable=True),
    )
    op.create_index('ix_bot_query_logs_api_key_id', 'bot_query_logs', ['api_key_id'])
    op.create_index('ix_bot_query_logs_external_user_fk', 'bot_query_logs', ['external_user_fk'])


def downgrade():
    op.drop_index('ix_bot_query_logs_external_user_fk', 'bot_query_logs')
    op.drop_index('ix_bot_query_logs_api_key_id', 'bot_query_logs')
    op.drop_column('bot_query_logs', 'external_user_fk')
    op.drop_column('bot_query_logs', 'api_key_id')
