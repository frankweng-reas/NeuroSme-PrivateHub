"""遷移：建立 companies 表（公司資訊）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("legal_name", sa.String(255), nullable=True),
        sa.Column("tax_id", sa.String(50), nullable=True),
        sa.Column("logo_url", sa.String(500), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("contact", sa.String(255), nullable=True),
        sa.Column("sort_order", sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("companies")
