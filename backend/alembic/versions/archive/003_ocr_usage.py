"""add usage tracking columns to ocr_extraction_history

Revision ID: 003_ocr_usage
Revises: 002_ocr_agent
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa

revision = '003_ocr_usage'
down_revision = '002_ocr_agent'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('ocr_extraction_history', sa.Column('model', sa.String(200), nullable=True))
    op.add_column('ocr_extraction_history', sa.Column('prompt_tokens', sa.Integer(), nullable=True))
    op.add_column('ocr_extraction_history', sa.Column('completion_tokens', sa.Integer(), nullable=True))
    op.add_column('ocr_extraction_history', sa.Column('total_tokens', sa.Integer(), nullable=True))
    op.add_column('ocr_extraction_history', sa.Column('latency_ms', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('ocr_extraction_history', 'latency_ms')
    op.drop_column('ocr_extraction_history', 'total_tokens')
    op.drop_column('ocr_extraction_history', 'completion_tokens')
    op.drop_column('ocr_extraction_history', 'prompt_tokens')
    op.drop_column('ocr_extraction_history', 'model')
