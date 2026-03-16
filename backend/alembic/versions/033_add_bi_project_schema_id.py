"""遷移：bi_projects 新增 schema_id 欄位（專案綁定 schema 配置）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bi_projects",
        sa.Column("schema_id", sa.String(100), nullable=True, server_default="fact_business_operations"),
    )


def downgrade() -> None:
    op.drop_column("bi_projects", "schema_id")
