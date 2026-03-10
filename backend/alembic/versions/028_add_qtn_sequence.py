"""遷移：新增 qtn_sequence 表（報價單號序號：年份＋流水號）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "qtn_sequence",
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("last_seq", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("year", "tenant_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_qtn_sequence_tenant_id", "qtn_sequence", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_qtn_sequence_tenant_id", table_name="qtn_sequence")
    op.drop_table("qtn_sequence")
