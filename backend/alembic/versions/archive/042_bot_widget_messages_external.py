"""042_bot_widget_messages_external

Revision ID: 042
Revises: 041
Create Date: 2026-05-22

bot_widget_messages 擴充，以支援 FB Messenger 等外部平台的對話歷史：
  - session_id 改為 NULLABLE（現有 Widget 資料不受影響）
  - 新增 external_user_fk → bot_external_users.id

資料語意：
  Widget 訊息：session_id 有值，external_user_fk = NULL
  外部平台訊息：session_id = NULL，external_user_fk 有值
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '042'
down_revision = '041'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('bot_widget_messages', 'session_id', nullable=True)
    op.add_column(
        'bot_widget_messages',
        sa.Column(
            'external_user_fk',
            UUID(as_uuid=True),
            sa.ForeignKey('bot_external_users.id', ondelete='CASCADE'),
            nullable=True,
        ),
    )
    op.create_index(
        'ix_bot_widget_messages_external_user_fk',
        'bot_widget_messages',
        ['external_user_fk'],
    )


def downgrade():
    op.drop_index('ix_bot_widget_messages_external_user_fk', 'bot_widget_messages')
    op.drop_column('bot_widget_messages', 'external_user_fk')
    op.alter_column('bot_widget_messages', 'session_id', nullable=False)
