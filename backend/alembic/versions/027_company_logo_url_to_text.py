"""遷移：companies.logo_url 改為 Text（支援 base64 data URL）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "companies",
        "logo_url",
        existing_type=sa.String(500),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "companies",
        "logo_url",
        existing_type=sa.Text(),
        type_=sa.String(500),
        existing_nullable=True,
    )
