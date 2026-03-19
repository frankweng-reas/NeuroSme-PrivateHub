"""遷移：新增 user_schema_mappings 表（mapping 範本長存）"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "034"
down_revision: Union[str, None] = "033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_schema_mappings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("schema_id", sa.String(100), nullable=False),
        sa.Column("template_name", sa.String(255), nullable=False),
        sa.Column("mapping", sa.Text(), nullable=False),
        sa.Column("csv_headers", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "schema_id", "template_name", name="uq_user_schema_template"),
    )
    op.create_index(op.f("ix_user_schema_mappings_user_id"), "user_schema_mappings", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_schema_mappings_schema_id"), "user_schema_mappings", ["schema_id"], unique=False)
    op.create_index(op.f("ix_user_schema_mappings_template_name"), "user_schema_mappings", ["template_name"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_user_schema_mappings_template_name"), table_name="user_schema_mappings")
    op.drop_index(op.f("ix_user_schema_mappings_schema_id"), table_name="user_schema_mappings")
    op.drop_index(op.f("ix_user_schema_mappings_user_id"), table_name="user_schema_mappings")
    op.drop_table("user_schema_mappings")
