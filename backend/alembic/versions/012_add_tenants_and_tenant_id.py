"""遷移：建立 tenants 表，並在 users、agents、user_agents 新增 tenant_id

Revision ID: 012
Revises: 011
Create Date: 2025-03-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 建立 tenants 表
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(100), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # 2. 新增 tenant test_comp
    op.execute(
        sa.text("INSERT INTO tenants (id, name) VALUES ('test_comp', 'Test Company')")
    )

    # 3. users 表新增 tenant_id
    op.add_column(
        "users",
        sa.Column("tenant_id", sa.String(100), nullable=True),
    )
    op.execute(sa.text("UPDATE users SET tenant_id = 'test_comp'"))
    op.alter_column(
        "users",
        "tenant_id",
        existing_type=sa.String(100),
        nullable=False,
    )
    op.create_foreign_key(
        "fk_users_tenant_id",
        "users",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(op.f("ix_users_tenant_id"), "users", ["tenant_id"], unique=False)

    # 4. agents 表新增 tenant_id
    op.add_column(
        "agents",
        sa.Column("tenant_id", sa.String(100), nullable=True),
    )
    op.execute(sa.text("UPDATE agents SET tenant_id = 'test_comp'"))
    op.alter_column(
        "agents",
        "tenant_id",
        existing_type=sa.String(100),
        nullable=False,
    )
    op.create_foreign_key(
        "fk_agents_tenant_id",
        "agents",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(op.f("ix_agents_tenant_id"), "agents", ["tenant_id"], unique=False)

    # 5. user_agents 表新增 tenant_id
    op.add_column(
        "user_agents",
        sa.Column("tenant_id", sa.String(100), nullable=True),
    )
    op.execute(sa.text("UPDATE user_agents SET tenant_id = 'test_comp'"))
    op.alter_column(
        "user_agents",
        "tenant_id",
        existing_type=sa.String(100),
        nullable=False,
    )
    op.create_foreign_key(
        "fk_user_agents_tenant_id",
        "user_agents",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        op.f("ix_user_agents_tenant_id"), "user_agents", ["tenant_id"], unique=False
    )


def downgrade() -> None:
    # user_agents
    op.drop_index(op.f("ix_user_agents_tenant_id"), table_name="user_agents")
    op.drop_constraint("fk_user_agents_tenant_id", "user_agents", type_="foreignkey")
    op.drop_column("user_agents", "tenant_id")

    # agents
    op.drop_index(op.f("ix_agents_tenant_id"), table_name="agents")
    op.drop_constraint("fk_agents_tenant_id", "agents", type_="foreignkey")
    op.drop_column("agents", "tenant_id")

    # users
    op.drop_index(op.f("ix_users_tenant_id"), table_name="users")
    op.drop_constraint("fk_users_tenant_id", "users", type_="foreignkey")
    op.drop_column("users", "tenant_id")

    # tenants
    op.drop_table("tenants")
