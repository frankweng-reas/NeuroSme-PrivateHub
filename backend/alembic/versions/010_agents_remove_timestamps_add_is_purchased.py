"""遷移：agents 表移除 created_at/updated_at，新增 is_purchased

Revision ID: 010
Revises: 009
Create Date: 2025-03-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("is_purchased", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.drop_column("agents", "created_at")
    op.drop_column("agents", "updated_at")


def downgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "agents",
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.drop_column("agents", "is_purchased")
