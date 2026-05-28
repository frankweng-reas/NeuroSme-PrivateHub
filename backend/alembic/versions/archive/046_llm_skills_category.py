"""046_llm_skills_category

Revision ID: 046
Revises: 045
Create Date: 2026-05-27

llm_skills 新增 category 欄位：自由輸入分類名稱（選填）
"""
from alembic import op
import sqlalchemy as sa

revision = '046'
down_revision = '045'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('llm_skills', sa.Column('category', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('llm_skills', 'category')
