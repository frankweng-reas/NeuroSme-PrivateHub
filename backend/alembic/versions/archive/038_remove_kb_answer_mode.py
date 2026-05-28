"""038_remove_kb_answer_mode

Revision ID: 038
Revises: 037
Create Date: 2026-05-21
"""
from alembic import op
import sqlalchemy as sa

revision = '038'
down_revision = '037'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column('km_knowledge_bases', 'answer_mode')


def downgrade():
    op.add_column(
        'km_knowledge_bases',
        sa.Column(
            'answer_mode',
            sa.String(20),
            nullable=False,
            server_default='rag',
        ),
    )
