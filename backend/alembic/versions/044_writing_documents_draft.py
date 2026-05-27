"""044_writing_documents_draft

Revision ID: 044
Revises: 043
Create Date: 2026-05-27

writing_documents 新增 draft 欄位：儲存最後一次 AI 生成的草稿
"""
from alembic import op
import sqlalchemy as sa

revision = '044'
down_revision = '043'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('writing_documents', sa.Column('draft', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('writing_documents', 'draft')
