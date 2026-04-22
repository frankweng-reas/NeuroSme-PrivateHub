"""Add speech config columns to tenant_configs

Revision ID: 013_speech_config
Revises: 012_ordering_sessions
Create Date: 2026-04-22
"""
import sqlalchemy as sa
from alembic import op

revision = "013_speech_config"
down_revision = "012_ordering_sessions"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tenant_configs", sa.Column("speech_provider", sa.String(50), nullable=True))
    op.add_column("tenant_configs", sa.Column("speech_base_url", sa.String(500), nullable=True))
    op.add_column("tenant_configs", sa.Column("speech_api_key_encrypted", sa.Text(), nullable=True))
    op.add_column("tenant_configs", sa.Column("speech_model", sa.String(255), nullable=True))


def downgrade():
    op.drop_column("tenant_configs", "speech_model")
    op.drop_column("tenant_configs", "speech_api_key_encrypted")
    op.drop_column("tenant_configs", "speech_base_url")
    op.drop_column("tenant_configs", "speech_provider")
