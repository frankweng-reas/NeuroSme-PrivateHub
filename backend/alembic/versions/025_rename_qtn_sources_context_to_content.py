"""遷移：qtn_sources 欄位 context 更名為 content（與 qtn_catalog、source_file 一致）"""
from typing import Sequence, Union

from alembic import op


revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "qtn_sources",
        "context",
        new_column_name="content",
    )


def downgrade() -> None:
    op.alter_column(
        "qtn_sources",
        "content",
        new_column_name="context",
    )
