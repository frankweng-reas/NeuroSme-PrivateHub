"""Initial schema — squashed from migrations 000–013

Revision ID: 000_initial
Revises: (none)
Create Date: 2026-04-22
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "000_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # ── Extensions ────────────────────────────────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── Tables（依 FK 相依順序）────────────────────────────────────────────────

    # tenants（無 FK，最先建）
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
    )
    op.create_index("ix_tenants_id", "tenants", ["id"])

    # agent_catalog（無 FK）
    op.create_table(
        "agent_catalog",
        sa.Column("agent_id", sa.String(100), primary_key=True),
        sa.Column("sort_id", sa.String(100), nullable=True),
        sa.Column("group_id", sa.String(100), nullable=False),
        sa.Column("group_name", sa.String(255), nullable=False),
        sa.Column("agent_name", sa.String(255), nullable=False),
        sa.Column("icon_name", sa.String(100), nullable=True),
        sa.Column("backend_router", sa.String(255), nullable=True),
        sa.Column("frontend_key", sa.String(100), nullable=True),
    )
    op.create_index("ix_agent_catalog_agent_id", "agent_catalog", ["agent_id"])
    op.create_index("ix_agent_catalog_group_id", "agent_catalog", ["group_id"])
    op.create_index("ix_agent_catalog_sort_id", "agent_catalog", ["sort_id"])

    # companies（無 FK）
    op.create_table(
        "companies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("legal_name", sa.String(255), nullable=True),
        sa.Column("tax_id", sa.String(50), nullable=True),
        sa.Column("logo_url", sa.Text(), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("contact", sa.String(255), nullable=True),
        sa.Column("sort_order", sa.String(50), nullable=True),
        sa.Column("quotation_terms", sa.Text(), nullable=True),
    )

    # users（FK → tenants）
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])

    # activation_codes（FK → tenants）
    op.create_table(
        "activation_codes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("customer_name", sa.String(255), nullable=False),
        sa.Column("agent_ids", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tenant_id", sa.String(100), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_activation_codes_code_hash", "activation_codes", ["code_hash"], unique=True)
    op.create_index("ix_activation_codes_tenant_id", "activation_codes", ["tenant_id"])

    # api_keys（FK → tenants, users）
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("key_prefix", sa.String(12), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_api_keys_tenant_id", "api_keys", ["tenant_id"])
    op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"], unique=True)

    # api_key_usages（FK → api_keys）
    op.create_table(
        "api_key_usages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("api_key_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["api_key_id"], ["api_keys.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("api_key_id", "date", name="uq_api_key_usages_key_date"),
    )
    op.create_index("ix_api_key_usages_api_key_id", "api_key_usages", ["api_key_id"])
    op.create_index("ix_api_key_usages_date", "api_key_usages", ["date"])

    # bi_projects（FK → tenants）
    op.create_table(
        "bi_projects",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.String(100), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("project_name", sa.String(255), nullable=False),
        sa.Column("project_desc", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("conversation_data", postgresql.JSONB(), nullable=True),
        sa.Column("schema_id", sa.String(100), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_bi_projects_tenant_id", "bi_projects", ["tenant_id"])
    op.create_index("ix_bi_projects_user_id", "bi_projects", ["user_id"])
    op.create_index("ix_bi_projects_agent_id", "bi_projects", ["agent_id"])

    # bi_sample_qa（FK → tenants）
    op.create_table(
        "bi_sample_qa",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.String(100), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_bi_sample_qa_tenant_id", "bi_sample_qa", ["tenant_id"])
    op.create_index("ix_bi_sample_qa_user_id", "bi_sample_qa", ["user_id"])
    op.create_index("ix_bi_sample_qa_agent_id", "bi_sample_qa", ["agent_id"])

    # bi_schemas（FK → users）
    op.create_table(
        "bi_schemas",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("desc", sa.Text(), nullable=True),
        sa.Column("schema_json", postgresql.JSONB(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("agent_id", sa.String(100), nullable=True),
        sa.Column("is_template", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_bi_schemas_id", "bi_schemas", ["id"])
    op.create_index("ix_bi_schemas_user_id", "bi_schemas", ["user_id"])
    op.create_index("ix_bi_schemas_agent_id", "bi_schemas", ["agent_id"])

    # bi_sources（FK → bi_projects）
    op.create_table(
        "bi_sources",
        sa.Column("source_id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("is_selected", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["bi_projects.project_id"], ondelete="CASCADE"),
    )
    op.create_index("ix_bi_sources_project_id", "bi_sources", ["project_id"])
    op.create_index("ix_bi_sources_source_type", "bi_sources", ["source_type"])

    # chat_threads（FK → tenants, users）
    op.create_table(
        "chat_threads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extra", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_chat_threads_tenant_id", "chat_threads", ["tenant_id"])
    op.create_index("ix_chat_threads_user_id", "chat_threads", ["user_id"])
    op.create_index("ix_chat_threads_agent_id", "chat_threads", ["agent_id"])

    # chat_llm_requests（FK → tenants, chat_threads, users）
    op.create_table(
        "chat_llm_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("model", sa.String(255), nullable=True),
        sa.Column("provider", sa.String(64), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("trace_id", sa.String(128), nullable=True),
        sa.Column("extra", postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["thread_id"], ["chat_threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_chat_llm_requests_tenant_id", "chat_llm_requests", ["tenant_id"])
    op.create_index("ix_chat_llm_requests_thread_id", "chat_llm_requests", ["thread_id"])
    op.create_index("ix_chat_llm_requests_user_id", "chat_llm_requests", ["user_id"])
    op.create_index("ix_chat_llm_requests_trace_id", "chat_llm_requests", ["trace_id"])

    # chat_messages（FK → chat_threads, chat_llm_requests）
    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("llm_request_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("context_file_ids", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["thread_id"], ["chat_threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["llm_request_id"], ["chat_llm_requests.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_chat_messages_thread_id", "chat_messages", ["thread_id"])
    op.create_index("ix_chat_messages_llm_request_id", "chat_messages", ["llm_request_id"])

    # stored_files（FK → tenants, users）
    op.create_table(
        "stored_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=True),
        sa.Column("storage_backend", sa.String(32), nullable=False, server_default="local"),
        sa.Column("storage_rel_path", sa.Text(), nullable=False),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256_hex", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("storage_rel_path", name="stored_files_storage_rel_path_key"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_stored_files_tenant_id", "stored_files", ["tenant_id"])
    op.create_index("ix_stored_files_uploaded_by_user_id", "stored_files", ["uploaded_by_user_id"])

    # chat_message_attachments（FK → chat_messages, stored_files）
    op.create_table(
        "chat_message_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("message_id", "file_id", name="uq_chat_message_attachments_message_file"),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["file_id"], ["stored_files.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_chat_message_attachments_message_id", "chat_message_attachments", ["message_id"])
    op.create_index("ix_chat_message_attachments_file_id", "chat_message_attachments", ["file_id"])

    # notebooks（FK → tenants, users）
    op.create_table(
        "notebooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=True),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("extra", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_notebooks_tenant_id", "notebooks", ["tenant_id"])
    op.create_index("ix_notebooks_user_id", "notebooks", ["user_id"])
    op.create_index("ix_notebooks_agent_id", "notebooks", ["agent_id"])

    # notebook_sources（FK → notebooks, stored_files）
    op.create_table(
        "notebook_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("notebook_id", "file_id", name="uq_notebook_sources_notebook_file"),
        sa.ForeignKeyConstraint(["notebook_id"], ["notebooks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["file_id"], ["stored_files.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_notebook_sources_notebook_id", "notebook_sources", ["notebook_id"])
    op.create_index("ix_notebook_sources_file_id", "notebook_sources", ["file_id"])

    # llm_provider_configs（FK → tenants）
    op.create_table(
        "llm_provider_configs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("api_base_url", sa.Text(), nullable=True),
        sa.Column("default_model", sa.String(255), nullable=True),
        sa.Column("available_models", postgresql.JSONB(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_llm_provider_configs_tenant_id", "llm_provider_configs", ["tenant_id"])
    op.create_index("ix_llm_provider_configs_provider", "llm_provider_configs", ["provider"])
    op.create_index("ix_llm_provider_configs_is_active", "llm_provider_configs", ["is_active"])

    # tenant_configs（FK → tenants）
    op.create_table(
        "tenant_configs",
        sa.Column("tenant_id", sa.String(100), primary_key=True),
        sa.Column("default_llm_provider", sa.String(50), nullable=True),
        sa.Column("default_llm_model", sa.String(255), nullable=True),
        sa.Column("embedding_provider", sa.String(50), nullable=False, server_default="openai"),
        sa.Column("embedding_model", sa.String(255), nullable=False, server_default="text-embedding-3-small"),
        sa.Column("embedding_locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("embedding_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("speech_provider", sa.String(50), nullable=True),
        sa.Column("speech_base_url", sa.String(500), nullable=True),
        sa.Column("speech_api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("speech_model", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
    )

    # tenant_agents（FK → tenants, agent_catalog）
    op.create_table(
        "tenant_agents",
        sa.Column("tenant_id", sa.String(100), primary_key=True),
        sa.Column("agent_id", sa.String(100), primary_key=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["agent_catalog.agent_id"], ondelete="CASCADE"),
    )

    # user_agents（FK → tenants, users, agent_catalog）
    op.create_table(
        "user_agents",
        sa.Column("tenant_id", sa.String(100), primary_key=True),
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column("agent_id", sa.String(100), primary_key=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["agent_catalog.agent_id"], ondelete="CASCADE"),
    )
    op.create_index("ix_user_agents_tenant_id", "user_agents", ["tenant_id"])

    # prompt_templates（FK → tenants, users）
    op.create_table(
        "prompt_templates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_prompt_templates_id", "prompt_templates", ["id"])
    op.create_index("ix_prompt_templates_tenant_id", "prompt_templates", ["tenant_id"])
    op.create_index("ix_prompt_templates_user_id", "prompt_templates", ["user_id"])
    op.create_index("ix_prompt_templates_agent_id", "prompt_templates", ["agent_id"])

    # source_files（FK → tenants, users）
    op.create_table(
        "source_files",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("agent_id", sa.String(100), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_selected", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_source_files_id", "source_files", ["id"])
    op.create_index("ix_source_files_tenant_id", "source_files", ["tenant_id"])
    op.create_index("ix_source_files_user_id", "source_files", ["user_id"])
    op.create_index("ix_source_files_agent_id", "source_files", ["agent_id"])

    # km_knowledge_bases（FK → users）
    op.create_table(
        "km_knowledge_bases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("model_name", sa.String(100), nullable=True),
        sa.Column("system_prompt", sa.Text(), nullable=True),
        sa.Column("public_token", sa.String(64), nullable=True, comment="Widget 公開存取 token（UUID hex）"),
        sa.Column("widget_title", sa.String(100), nullable=True, comment="Widget 顯示名稱"),
        sa.Column("widget_logo_url", sa.Text(), nullable=True, comment="Widget logo（base64 data URL 或外部圖片 URL）"),
        sa.Column("widget_color", sa.String(20), nullable=True, server_default="#1A3A52", comment="Widget 主色（hex）"),
        sa.Column("widget_lang", sa.String(10), nullable=True, server_default="zh-TW", comment="Widget 預設語言"),
        sa.UniqueConstraint("public_token", name="km_knowledge_bases_public_token_key"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_km_knowledge_bases_tenant_id", "km_knowledge_bases", ["tenant_id"])
    op.create_index("ix_km_knowledge_bases_public_token", "km_knowledge_bases", ["public_token"])

    # km_documents（FK → tenants, users, km_knowledge_bases）
    op.create_table(
        "km_documents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.String(100), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("scope", sa.String(32), nullable=False, server_default="private"),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("chunk_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column("knowledge_base_id", sa.Integer(), nullable=True),
        sa.Column("doc_type", sa.String(32), nullable=False, server_default="article",
                  comment="article | policy | spec | faq | reference"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["knowledge_base_id"], ["km_knowledge_bases.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_km_documents_tenant_id", "km_documents", ["tenant_id"])
    op.create_index("ix_km_documents_owner_user_id", "km_documents", ["owner_user_id"])
    op.create_index("ix_km_documents_knowledge_base_id", "km_documents", ["knowledge_base_id"])

    # km_chunks（FK → km_documents，含 pgvector 768 維 embedding）
    op.create_table(
        "km_chunks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("embedding", sa.Text(), nullable=True),   # placeholder; replaced below
        sa.ForeignKeyConstraint(["document_id"], ["km_documents.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_km_chunks_document_id", "km_chunks", ["document_id"])
    # pgvector 欄位與 HNSW index 無法用標準 SA 型別定義，改用原始 SQL
    op.execute("ALTER TABLE km_chunks ALTER COLUMN embedding TYPE vector(768) USING NULL::vector(768)")
    op.execute(
        "CREATE INDEX km_chunks_embedding_hnsw ON km_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )

    # ordering_sessions（FK → api_keys）
    op.create_table(
        "ordering_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.String(255), nullable=False),
        sa.Column("api_key_id", sa.Integer(), nullable=False),
        sa.Column("kb_id", sa.Integer(), nullable=False),
        sa.Column("messages", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("session_id", "api_key_id", name="uq_ordering_session_api_key"),
        sa.ForeignKeyConstraint(["api_key_id"], ["api_keys.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_ordering_sessions_session_id", "ordering_sessions", ["session_id"])
    op.create_index("ix_ordering_sessions_api_key_id", "ordering_sessions", ["api_key_id"])

    # widget_sessions（FK → km_knowledge_bases）
    op.create_table(
        "widget_sessions",
        sa.Column("id", sa.String(64), primary_key=True, comment="Session UUID（前端 localStorage）"),
        sa.Column("kb_id", sa.Integer(), nullable=False),
        sa.Column("visitor_name", sa.String(100), nullable=True),
        sa.Column("visitor_email", sa.String(200), nullable=True),
        sa.Column("visitor_phone", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_active_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["kb_id"], ["km_knowledge_bases.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_widget_sessions_kb_id", "widget_sessions", ["kb_id"])

    # widget_messages（FK → widget_sessions）
    op.create_table(
        "widget_messages",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.String(64), nullable=False, comment="user | assistant"),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["widget_sessions.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_widget_messages_session_id", "widget_messages", ["session_id"])


def downgrade():
    # 依反向順序 drop
    tables = [
        "widget_messages", "widget_sessions",
        "ordering_sessions",
        "km_chunks", "km_documents", "km_knowledge_bases",
        "source_files", "prompt_templates",
        "user_agents", "tenant_agents", "tenant_configs",
        "llm_provider_configs",
        "notebook_sources", "notebooks",
        "chat_message_attachments", "stored_files",
        "chat_messages", "chat_llm_requests", "chat_threads",
        "bi_sources", "bi_schemas", "bi_sample_qa", "bi_projects",
        "api_key_usages", "api_keys",
        "activation_codes",
        "companies",
        "user_agents", "users",
        "tenant_agents", "agent_catalog", "tenants",
    ]
    for t in tables:
        op.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
