"""043_writing_documents

Revision ID: 043
Revises: 042
Create Date: 2026-05-27

新增 writing_documents 表：Writing Agent 的文件儲存
"""
from alembic import op
import sqlalchemy as sa

revision = '043'
down_revision = '042'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'writing_documents',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('tenant_id', sa.String(100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('user_prompt', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_writing_documents_tenant_id', 'writing_documents', ['tenant_id'])
    op.create_index('ix_writing_documents_user_id', 'writing_documents', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_writing_documents_user_id', table_name='writing_documents')
    op.drop_index('ix_writing_documents_tenant_id', table_name='writing_documents')
    op.drop_table('writing_documents')
