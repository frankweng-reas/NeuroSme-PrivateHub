"""Upgrade km_chunks.embedding from vector(768) to vector(1024) for bge-m3

Revision ID: 001_embedding_dim_1024
Revises: 000_initial_v2
Create Date: 2026-06-22
"""
from alembic import op


revision = "001_embedding_dim_1024"
down_revision = "000_initial_v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 將 embedding 欄位從 vector(768) 升級為 vector(1024)
    # 768 維向量與 1024 維不相容，必須清空後變更型別
    op.execute("ALTER TABLE km_chunks ALTER COLUMN embedding TYPE vector(1024) USING NULL::vector(1024)")


def downgrade() -> None:
    op.execute("ALTER TABLE km_chunks ALTER COLUMN embedding TYPE vector(768) USING NULL::vector(768)")
