"""041_messaging_integrations

Revision ID: 041
Revises: 040
Create Date: 2026-05-22

km_bots：新增 messaging_integrations JSONB 欄位，統一存放各平台整合設定。
JSONB 結構範例（FB）：
  {
    "fb": {
      "enabled": true,
      "page_access_token": "gAAAAAB...",  <- Fernet 加密
      "verify_token": "nsm_abc123",
      "connected_at": "2026-05-22T..."
    }
  }
未來 LINE / WhatsApp 直接在同欄位加 key，不需再 migration。
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '041'
down_revision = '040'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'km_bots',
        sa.Column(
            'messaging_integrations',
            JSONB,
            nullable=False,
            server_default='{}',
            comment='各平台 Messaging 整合設定（fb / line / custom）',
        ),
    )


def downgrade():
    op.drop_column('km_bots', 'messaging_integrations')
