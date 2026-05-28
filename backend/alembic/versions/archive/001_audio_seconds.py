"""add audio_seconds to api_key_usages

Revision ID: 001_audio_seconds
Revises: 000_initial
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa

revision = '001_audio_seconds'
down_revision = '000_initial'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'api_key_usages',
        sa.Column('audio_seconds', sa.Float(), nullable=False, server_default='0.0'),
    )


def downgrade() -> None:
    op.drop_column('api_key_usages', 'audio_seconds')
