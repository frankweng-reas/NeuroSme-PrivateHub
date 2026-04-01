"""Initial schema – single source of truth for the full database structure.

Revision ID: 001
Revises: (none)
Create Date: 2026-04-01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------ #
    # 1. tenants                                                           #
    # ------------------------------------------------------------------ #
    op.create_table(
        "tenants",
        sa.Column("id",   sa.String(100), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
    )
    op.create_index("ix_tenants_id", "tenants", ["id"])

    # ------------------------------------------------------------------ #
    # 2. agent_catalog  (agent_id is the natural PK)                      #
    # ------------------------------------------------------------------ #
    op.create_table(
        "agent_catalog",
        sa.Column("agent_id",   sa.String(100), primary_key=True),
        sa.Column("sort_id",    sa.String(100), nullable=True),
        sa.Column("group_id",   sa.String(100), nullable=False),
        sa.Column("group_name", sa.String(255), nullable=False),
        sa.Column("agent_name", sa.String(255), nullable=False),
        sa.Column("icon_name",  sa.String(100), nullable=True),
    )
    op.create_index("ix_agent_catalog_agent_id", "agent_catalog", ["agent_id"])
    op.create_index("ix_agent_catalog_sort_id",  "agent_catalog", ["sort_id"])
    op.create_index("ix_agent_catalog_group_id", "agent_catalog", ["group_id"])

    # ------------------------------------------------------------------ #
    # 3. users                                                             #
    # ------------------------------------------------------------------ #
    op.create_table(
        "users",
        sa.Column("id",              sa.Integer,      primary_key=True, autoincrement=True),
        sa.Column("email",           sa.String(255),  nullable=False),
        sa.Column("username",        sa.String(100),  nullable=False),
        sa.Column("hashed_password", sa.String(255),  nullable=False),
        sa.Column("role",            sa.String(20),   nullable=False, server_default="member"),
        sa.Column("tenant_id",       sa.String(100),  nullable=False),
        sa.Column("created_at",      sa.DateTime,     nullable=True),
        sa.Column("updated_at",      sa.DateTime,     nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_users_id",        "users", ["id"])
    op.create_index("ix_users_email",     "users", ["email"],     unique=True)
    op.create_index("ix_users_username",  "users", ["username"],  unique=True)
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])

    # ------------------------------------------------------------------ #
    # 4. tenant_agents                                                     #
    # ------------------------------------------------------------------ #
    op.create_table(
        "tenant_agents",
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("agent_id",  sa.String(100), nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", "agent_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"],             ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"],  ["agent_catalog.agent_id"], ondelete="CASCADE",
                                name="fk_tenant_agents_agent_catalog_semantic"),
    )

    # ------------------------------------------------------------------ #
    # 5. user_agents                                                       #
    # ------------------------------------------------------------------ #
    op.create_table(
        "user_agents",
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("user_id",   sa.Integer,     nullable=False),
        sa.Column("agent_id",  sa.String(100), nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", "user_id", "agent_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"],             ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"],   ["users.id"],               ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"],  ["agent_catalog.agent_id"], ondelete="CASCADE",
                                name="fk_user_agents_agent_catalog_semantic"),
    )
    op.create_index("ix_user_agents_tenant_id", "user_agents", ["tenant_id"])

    # ------------------------------------------------------------------ #
    # 6. source_files                                                      #
    # ------------------------------------------------------------------ #
    op.create_table(
        "source_files",
        sa.Column("id",          sa.Integer,                    primary_key=True, autoincrement=True),
        sa.Column("user_id",     sa.Integer,                    nullable=False),
        sa.Column("tenant_id",   sa.String(100),                nullable=False),
        sa.Column("agent_id",    sa.String(100),                nullable=False),
        sa.Column("file_name",   sa.String(255),                nullable=False),
        sa.Column("content",     sa.Text,                       nullable=False),
        sa.Column("is_selected", sa.Boolean,                    nullable=False, server_default=sa.true()),
        sa.Column("created_at",  sa.DateTime(timezone=True),    nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"],   ["users.id"],    ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"],  ondelete="RESTRICT"),
    )
    op.create_index("ix_source_files_id",        "source_files", ["id"])
    op.create_index("ix_source_files_user_id",   "source_files", ["user_id"])
    op.create_index("ix_source_files_tenant_id", "source_files", ["tenant_id"])
    op.create_index("ix_source_files_agent_id",  "source_files", ["agent_id"])

    # ------------------------------------------------------------------ #
    # 7. prompt_templates                                                  #
    # ------------------------------------------------------------------ #
    op.create_table(
        "prompt_templates",
        sa.Column("id",         sa.Integer,                  primary_key=True, autoincrement=True),
        sa.Column("user_id",    sa.Integer,                  nullable=False),
        sa.Column("tenant_id",  sa.String(100),              nullable=False),
        sa.Column("agent_id",   sa.String(100),              nullable=False),
        sa.Column("name",       sa.String(255),              nullable=False),
        sa.Column("content",    sa.Text,                     nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),  nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True),  nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"],   ["users.id"],   ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_prompt_templates_id",        "prompt_templates", ["id"])
    op.create_index("ix_prompt_templates_user_id",   "prompt_templates", ["user_id"])
    op.create_index("ix_prompt_templates_tenant_id", "prompt_templates", ["tenant_id"])
    op.create_index("ix_prompt_templates_agent_id",  "prompt_templates", ["agent_id"])

    # ------------------------------------------------------------------ #
    # 8. companies                                                         #
    # ------------------------------------------------------------------ #
    op.create_table(
        "companies",
        sa.Column("id",               postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("legal_name",       sa.String(255), nullable=True),
        sa.Column("tax_id",           sa.String(50),  nullable=True),
        sa.Column("logo_url",         sa.Text,        nullable=True),
        sa.Column("address",          sa.Text,        nullable=True),
        sa.Column("phone",            sa.String(50),  nullable=True),
        sa.Column("email",            sa.String(255), nullable=True),
        sa.Column("contact",          sa.String(255), nullable=True),
        sa.Column("sort_order",       sa.String(50),  nullable=True),
        sa.Column("quotation_terms",  sa.Text,        nullable=True),
    )

    # ------------------------------------------------------------------ #
    # 9. qtn_projects                                                      #
    # ------------------------------------------------------------------ #
    op.create_table(
        "qtn_projects",
        sa.Column("project_id",   postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id",    sa.String(100),              nullable=False),
        sa.Column("user_id",      sa.String(100),              nullable=False),
        sa.Column("agent_id",     sa.String(100),              nullable=False),
        sa.Column("project_name", sa.String(255),              nullable=False),
        sa.Column("project_desc", sa.Text,                     nullable=True),
        sa.Column("qtn_draft",    postgresql.JSONB,            nullable=True),
        sa.Column("qtn_final",    postgresql.JSONB,            nullable=True),
        sa.Column("status",       sa.String(50),               nullable=False, server_default="STEP1"),
        sa.Column("total_amount", sa.Numeric(15, 2),           nullable=True),
        sa.Column("currency",     sa.String(10),               nullable=True, server_default="TWD"),
        sa.Column("created_at",   sa.DateTime(timezone=True),  nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at",   sa.DateTime(timezone=True),  nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_qtn_projects_tenant_id", "qtn_projects", ["tenant_id"])
    op.create_index("ix_qtn_projects_user_id",   "qtn_projects", ["user_id"])
    op.create_index("ix_qtn_projects_agent_id",  "qtn_projects", ["agent_id"])

    # ------------------------------------------------------------------ #
    # 10. qtn_sources                                                      #
    # ------------------------------------------------------------------ #
    op.create_table(
        "qtn_sources",
        sa.Column("source_id",   postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id",  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", sa.String(50),                 nullable=False),
        sa.Column("file_name",   sa.String(255),                nullable=False),
        sa.Column("content",     sa.Text,                       nullable=True),
        sa.Column("created_at",  sa.DateTime(timezone=True),    nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["project_id"], ["qtn_projects.project_id"], ondelete="CASCADE"),
    )
    op.create_index("ix_qtn_sources_project_id",  "qtn_sources", ["project_id"])
    op.create_index("ix_qtn_sources_source_type", "qtn_sources", ["source_type"])

    # ------------------------------------------------------------------ #
    # 11. qtn_catalogs                                                     #
    # ------------------------------------------------------------------ #
    op.create_table(
        "qtn_catalogs",
        sa.Column("catalog_id",   postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id",    sa.String(100),             nullable=False),
        sa.Column("catalog_name", sa.String(255),             nullable=False),
        sa.Column("content",      sa.Text,                    nullable=True),
        sa.Column("is_default",   sa.Boolean,                 nullable=False, server_default=sa.false()),
        sa.Column("created_at",   sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at",   sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_qtn_catalogs_tenant_id", "qtn_catalogs", ["tenant_id"])

    # ------------------------------------------------------------------ #
    # 12. qtn_sequence                                                     #
    # ------------------------------------------------------------------ #
    op.create_table(
        "qtn_sequence",
        sa.Column("year",      sa.Integer,     nullable=False),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("last_seq",  sa.Integer,     nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("year", "tenant_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_qtn_sequence_tenant_id", "qtn_sequence", ["tenant_id"])

    # ------------------------------------------------------------------ #
    # 13. bi_projects                                                      #
    # ------------------------------------------------------------------ #
    op.create_table(
        "bi_projects",
        sa.Column("project_id",        postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id",         sa.String(100),             nullable=False),
        sa.Column("user_id",           sa.String(100),             nullable=False),
        sa.Column("agent_id",          sa.String(100),             nullable=False),
        sa.Column("project_name",      sa.String(255),             nullable=False),
        sa.Column("project_desc",      sa.Text,                    nullable=True),
        sa.Column("created_at",        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at",        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("conversation_data", postgresql.JSONB,           nullable=True),
        sa.Column("schema_id",         sa.String(100),             nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_bi_projects_tenant_id", "bi_projects", ["tenant_id"])
    op.create_index("ix_bi_projects_user_id",   "bi_projects", ["user_id"])
    op.create_index("ix_bi_projects_agent_id",  "bi_projects", ["agent_id"])

    # ------------------------------------------------------------------ #
    # 14. bi_sources                                                       #
    # ------------------------------------------------------------------ #
    op.create_table(
        "bi_sources",
        sa.Column("source_id",   postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id",  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", sa.String(50),                 nullable=False),
        sa.Column("file_name",   sa.String(255),                nullable=False),
        sa.Column("content",     sa.Text,                       nullable=True),
        sa.Column("is_selected", sa.Boolean,                    nullable=False, server_default=sa.true()),
        sa.Column("created_at",  sa.DateTime(timezone=True),    nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["project_id"], ["bi_projects.project_id"], ondelete="CASCADE"),
    )
    op.create_index("ix_bi_sources_project_id",  "bi_sources", ["project_id"])
    op.create_index("ix_bi_sources_source_type", "bi_sources", ["source_type"])

    # ------------------------------------------------------------------ #
    # 15. bi_schemas                                                       #
    # ------------------------------------------------------------------ #
    op.create_table(
        "bi_schemas",
        sa.Column("id",          sa.String(100),             primary_key=True),
        sa.Column("name",        sa.String(255),             nullable=False),
        sa.Column("desc",        sa.Text,                    nullable=True),
        sa.Column("schema_json", postgresql.JSONB,           nullable=False),
        sa.Column("user_id",     sa.Integer,                 nullable=True),
        sa.Column("agent_id",    sa.String(100),             nullable=True),
        sa.Column("is_template", sa.Boolean,                 nullable=False, server_default=sa.false()),
        sa.Column("created_at",  sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at",  sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_bi_schemas_id",       "bi_schemas", ["id"])
    op.create_index("ix_bi_schemas_user_id",  "bi_schemas", ["user_id"])
    op.create_index("ix_bi_schemas_agent_id", "bi_schemas", ["agent_id"])

    # ------------------------------------------------------------------ #
    # 16. llm_provider_configs                                             #
    # ------------------------------------------------------------------ #
    op.create_table(
        "llm_provider_configs",
        sa.Column("id",                sa.Integer,                  primary_key=True, autoincrement=True),
        sa.Column("tenant_id",         sa.String(100),              nullable=False),
        sa.Column("provider",          sa.String(50),               nullable=False),
        sa.Column("label",             sa.String(255),              nullable=True),
        sa.Column("api_key_encrypted", sa.Text,                     nullable=True),
        sa.Column("api_base_url",      sa.Text,                     nullable=True),
        sa.Column("default_model",     sa.String(255),              nullable=True),
        sa.Column("available_models",  postgresql.JSONB,            nullable=True),
        sa.Column("is_active",         sa.Boolean,                  nullable=False, server_default=sa.true()),
        sa.Column("created_at",        sa.DateTime(timezone=True),  nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at",        sa.DateTime(timezone=True),  nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"],
                                name="fk_llm_provider_configs_tenant_id", ondelete="RESTRICT"),
    )
    op.create_index("ix_llm_provider_configs_tenant_id", "llm_provider_configs", ["tenant_id"])
    op.create_index("ix_llm_provider_configs_provider",  "llm_provider_configs", ["provider"])
    op.create_index("ix_llm_provider_configs_is_active", "llm_provider_configs", ["is_active"])


def downgrade() -> None:
    op.drop_table("llm_provider_configs")
    op.drop_table("bi_schemas")
    op.drop_table("bi_sources")
    op.drop_table("bi_projects")
    op.drop_table("qtn_sequence")
    op.drop_table("qtn_catalogs")
    op.drop_table("qtn_sources")
    op.drop_table("qtn_projects")
    op.drop_table("companies")
    op.drop_table("prompt_templates")
    op.drop_table("source_files")
    op.drop_table("user_agents")
    op.drop_table("tenant_agents")
    op.drop_table("users")
    op.drop_table("agent_catalog")
    op.drop_table("tenants")
