"""遷移：將種子 agents 設為 is_purchased=true

Revision ID: 011
Revises: 010
Create Date: 2025-03-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE agents SET is_purchased = true"))


def downgrade() -> None:
    op.execute(sa.text("UPDATE agents SET is_purchased = false"))
