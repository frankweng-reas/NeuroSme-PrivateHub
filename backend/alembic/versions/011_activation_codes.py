"""activation_codes 表：儲存產生與兌換的授權碼記錄。

Revision ID: 011
Revises: 010
Create Date: 2026-04-12
"""

from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activation_codes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("customer_name", sa.String(255), nullable=False),
        sa.Column("agent_ids", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tenant_id", sa.String(100), sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_activation_codes_code_hash", "activation_codes", ["code_hash"])
    op.create_index("ix_activation_codes_tenant_id", "activation_codes", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_activation_codes_tenant_id", "activation_codes")
    op.drop_index("ix_activation_codes_code_hash", "activation_codes")
    op.drop_table("activation_codes")
