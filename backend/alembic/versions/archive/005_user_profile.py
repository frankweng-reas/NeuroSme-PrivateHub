"""add display_name and avatar_b64 to users

Revision ID: 005_user_profile
Revises: 004_agent_usage_log
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa

revision = '005_user_profile'
down_revision = '004_agent_usage_log'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('display_name', sa.String(100), nullable=True))
    op.add_column('users', sa.Column('avatar_b64', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'avatar_b64')
    op.drop_column('users', 'display_name')
