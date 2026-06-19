"""Initial schema (generated from live DB)

Revision ID: 000_initial_v2
Revises:
Create Date: 2026-06-19
"""
from alembic import op


revision = "000_initial_v2"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
CREATE EXTENSION IF NOT EXISTS pg_cjk_parser WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TEXT SEARCH PARSER public.pg_cjk_parser (
    START = public.prsd2_cjk_start,
    GETTOKEN = public.prsd2_cjk_nexttoken,
    END = public.prsd2_cjk_end,
    HEADLINE = public.prsd2_cjk_headline,
    LEXTYPES = public.prsd2_cjk_lextype );

CREATE TEXT SEARCH CONFIGURATION public.cjk (
    PARSER = public.pg_cjk_parser );

ALTER TEXT SEARCH CONFIGURATION public.cjk
    ADD MAPPING FOR asciiword WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.cjk
    ADD MAPPING FOR word WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.cjk
    ADD MAPPING FOR numword WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.cjk
    ADD MAPPING FOR sfloat WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.cjk
    ADD MAPPING FOR version WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.cjk
    ADD MAPPING FOR "float" WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.cjk
    ADD MAPPING FOR "int" WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.cjk
    ADD MAPPING FOR uint WITH simple;

ALTER TEXT SEARCH CONFIGURATION public.cjk
    ADD MAPPING FOR cjk WITH simple;

CREATE TABLE public.activation_codes (
    id integer NOT NULL,
    code_hash text NOT NULL,
    customer_name character varying(255) NOT NULL,
    agent_ids text NOT NULL,
    expires_at date,
    created_at timestamp with time zone NOT NULL,
    activated_at timestamp with time zone,
    tenant_id character varying(100)
);

CREATE SEQUENCE public.activation_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.activation_codes_id_seq OWNED BY public.activation_codes.id;

CREATE TABLE public.agent_catalog (
    agent_id character varying(100) NOT NULL,
    sort_id character varying(100),
    group_id character varying(100) NOT NULL,
    group_name character varying(255) NOT NULL,
    agent_name character varying(255) NOT NULL,
    icon_name character varying(100),
    backend_router character varying(255),
    frontend_key character varying(100)
);

CREATE TABLE public.agent_usage_logs (
    id integer NOT NULL,
    agent_type character varying(50) NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer,
    model character varying(200),
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    latency_ms integer,
    status character varying(20) DEFAULT 'success'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.agent_usage_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.agent_usage_logs_id_seq OWNED BY public.agent_usage_logs.id;

CREATE TABLE public.api_key_usages (
    id integer NOT NULL,
    api_key_id integer NOT NULL,
    date date NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    audio_seconds double precision DEFAULT '0'::double precision NOT NULL
);

CREATE SEQUENCE public.api_key_usages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.api_key_usages_id_seq OWNED BY public.api_key_usages.id;

CREATE TABLE public.api_keys (
    id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    name character varying(100) NOT NULL,
    key_prefix character varying(12) NOT NULL,
    key_hash character varying(64) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    bot_id integer,
    key_type character varying(20) DEFAULT 'bot'::character varying NOT NULL,
    label character varying(100)
);

CREATE SEQUENCE public.api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.api_keys_id_seq OWNED BY public.api_keys.id;

CREATE TABLE public.bi_projects (
    project_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id character varying(100) NOT NULL,
    agent_id character varying(100) NOT NULL,
    project_name character varying(255) NOT NULL,
    project_desc text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    conversation_data jsonb,
    schema_id character varying(100)
);

CREATE TABLE public.bi_sample_qa (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id character varying(100) NOT NULL,
    agent_id character varying(100) NOT NULL,
    question_text text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bi_schemas (
    id character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    "desc" text,
    schema_json jsonb NOT NULL,
    user_id integer,
    agent_id character varying(100),
    is_template boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bi_sources (
    source_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    source_type character varying(50) NOT NULL,
    file_name character varying(255) NOT NULL,
    content text,
    is_selected boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bot_external_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id character varying(100) NOT NULL,
    bot_id integer NOT NULL,
    external_platform character varying(30) NOT NULL,
    external_user_id character varying(200) NOT NULL,
    display_name character varying(200),
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bot_query_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id character varying(100) NOT NULL,
    bot_id integer NOT NULL,
    session_id character varying(64),
    query text NOT NULL,
    hit boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    api_key_id integer,
    external_user_fk uuid
);

CREATE TABLE public.bot_widget_messages (
    id bigint NOT NULL,
    session_id character varying(64),
    role character varying(20) NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    external_user_fk uuid
);

CREATE SEQUENCE public.bot_widget_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.bot_widget_messages_id_seq OWNED BY public.bot_widget_messages.id;

CREATE TABLE public.bot_widget_sessions (
    id character varying(64) NOT NULL,
    bot_id integer NOT NULL,
    visitor_name character varying(100),
    visitor_email character varying(200),
    visitor_phone character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.km_bots (
    id integer NOT NULL,
    tenant_id character varying NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    system_prompt text,
    model_name character varying(100),
    public_token character varying(64),
    widget_title character varying(100),
    widget_logo_url text,
    widget_color character varying(20) DEFAULT '''#1A3A52'''::character varying,
    widget_lang character varying(10) DEFAULT '''zh-TW'''::character varying,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    widget_voice_enabled boolean DEFAULT false NOT NULL,
    widget_voice_prompt text,
    fallback_message text,
    fallback_message_enabled boolean DEFAULT false NOT NULL,
    answer_mode character varying(20) DEFAULT 'rag'::character varying NOT NULL,
    home_enabled boolean DEFAULT false NOT NULL,
    home_greeting text,
    home_quick_questions text,
    common_faq_enabled boolean DEFAULT false NOT NULL,
    popular_faq_enabled boolean DEFAULT false NOT NULL,
    contact_enabled boolean DEFAULT false NOT NULL,
    contact_links text,
    access_mode character varying(20) DEFAULT 'public'::character varying NOT NULL,
    messaging_integrations jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE SEQUENCE public.bots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.bots_id_seq OWNED BY public.km_bots.id;

CREATE TABLE public.chat_llm_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer,
    thread_id uuid NOT NULL,
    model character varying(255),
    provider character varying(64),
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    latency_ms integer,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    error_code character varying(64),
    error_message text,
    trace_id character varying(128),
    extra jsonb
);

CREATE TABLE public.chat_message_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    file_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    sequence integer NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    llm_request_id uuid,
    context_file_ids jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.chat_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer NOT NULL,
    agent_id character varying(100) NOT NULL,
    title character varying(512),
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    last_message_at timestamp with time zone,
    extra jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    document_context text,
    document_filename character varying(512)
);

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legal_name character varying(255),
    tax_id character varying(50),
    logo_url text,
    address text,
    phone character varying(50),
    email character varying(255),
    contact character varying(255),
    sort_order character varying(50),
    quotation_terms text
);

CREATE TABLE public.doc_image_configs (
    id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer,
    name character varying(200) NOT NULL,
    model character varying(200) DEFAULT ''::character varying NOT NULL,
    extraction_topics jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.doc_image_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.doc_image_configs_id_seq OWNED BY public.doc_image_configs.id;

CREATE TABLE public.doc_image_history (
    id integer NOT NULL,
    config_id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer,
    filename character varying(500) DEFAULT ''::character varying NOT NULL,
    raw_text text DEFAULT ''::text NOT NULL,
    result_markdown text DEFAULT ''::text NOT NULL,
    status character varying(20) DEFAULT 'success'::character varying NOT NULL,
    error_message text,
    model character varying(200),
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.doc_image_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.doc_image_history_id_seq OWNED BY public.doc_image_history.id;

CREATE TABLE public.doc_parse_evaluation (
    id integer NOT NULL,
    result_id integer NOT NULL,
    item_type character varying(20) NOT NULL,
    item_key character varying(500) NOT NULL,
    cite text,
    sort_order integer DEFAULT 0 NOT NULL,
    mandatory boolean,
    assignee character varying(200),
    due_date date,
    status character varying(20) DEFAULT '''todo'''::character varying,
    capability character varying(20),
    risk_level character varying(10),
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.doc_parse_evaluation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.doc_parse_evaluation_id_seq OWNED BY public.doc_parse_evaluation.id;

CREATE TABLE public.doc_parse_profiles (
    id integer NOT NULL,
    profile_id character varying(80) NOT NULL,
    profile_name character varying(200) NOT NULL,
    tenant_id character varying,
    definition jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.doc_parse_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.doc_parse_profiles_id_seq OWNED BY public.doc_parse_profiles.id;

CREATE TABLE public.doc_parse_results (
    id integer NOT NULL,
    user_id integer NOT NULL,
    tenant_id character varying,
    profile_id character varying(80) NOT NULL,
    profile_name character varying(200) NOT NULL,
    file_name character varying(500) NOT NULL,
    page_count integer,
    model character varying(200) DEFAULT ''::character varying NOT NULL,
    result_json jsonb NOT NULL,
    usage_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.doc_parse_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.doc_parse_results_id_seq OWNED BY public.doc_parse_results.id;

CREATE TABLE public.estimator_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer NOT NULL,
    name character varying(255) NOT NULL,
    schema_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.km_bot_faqs (
    id integer NOT NULL,
    bot_id integer NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    faq_type character varying(20) DEFAULT 'common'::character varying NOT NULL
);

CREATE SEQUENCE public.km_bot_faqs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.km_bot_faqs_id_seq OWNED BY public.km_bot_faqs.id;

CREATE TABLE public.km_bot_kb (
    bot_id integer NOT NULL,
    knowledge_base_id integer NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.km_chunks (
    id integer NOT NULL,
    document_id integer NOT NULL,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    metadata json,
    embedding public.vector(768),
    content_tsv tsvector
);

CREATE SEQUENCE public.km_chunks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.km_chunks_id_seq OWNED BY public.km_chunks.id;

CREATE TABLE public.km_connectors (
    id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    knowledge_base_id integer NOT NULL,
    created_by integer,
    source_type character varying(32) NOT NULL,
    display_name character varying(100) NOT NULL,
    config json DEFAULT '{}'::json NOT NULL,
    credentials_enc text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    sync_interval_minutes integer DEFAULT 60 NOT NULL,
    last_cursor character varying(255),
    last_synced_at timestamp with time zone,
    last_error text,
    force_full_sync boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.km_connectors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.km_connectors_id_seq OWNED BY public.km_connectors.id;

CREATE TABLE public.km_documents (
    id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    owner_user_id integer,
    filename character varying(512) NOT NULL,
    content_type character varying(255),
    size_bytes bigint,
    scope character varying(32) DEFAULT 'private'::character varying NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    error_message text,
    chunk_count integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tags json,
    knowledge_base_id integer,
    doc_type character varying(32) DEFAULT 'article'::character varying NOT NULL
);

CREATE SEQUENCE public.km_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.km_documents_id_seq OWNED BY public.km_documents.id;

CREATE TABLE public.km_knowledge_bases (
    id integer NOT NULL,
    tenant_id character varying NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    model_name character varying(100),
    system_prompt text,
    scope character varying(20) DEFAULT 'personal'::character varying NOT NULL
);

CREATE SEQUENCE public.km_knowledge_bases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.km_knowledge_bases_id_seq OWNED BY public.km_knowledge_bases.id;

CREATE TABLE public.km_query_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer,
    knowledge_base_id integer NOT NULL,
    answer_mode character varying(32) NOT NULL,
    query text NOT NULL,
    hit boolean DEFAULT false NOT NULL,
    matched_chunk_ids jsonb,
    session_type character varying(32) DEFAULT 'internal'::character varying NOT NULL,
    widget_session_id character varying(64),
    chat_thread_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.llm_provider_configs (
    id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    provider character varying(50) NOT NULL,
    label character varying(255),
    api_key_encrypted text,
    api_base_url text,
    default_model character varying(255),
    available_models jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    gcp_project_id character varying(255),
    gcp_region character varying(100)
);

CREATE SEQUENCE public.llm_provider_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.llm_provider_configs_id_seq OWNED BY public.llm_provider_configs.id;

CREATE TABLE public.llm_skills (
    id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    created_by integer,
    title character varying(200) NOT NULL,
    description character varying(500),
    prompt text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    category character varying(100)
);

CREATE SEQUENCE public.llm_skills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.llm_skills_id_seq OWNED BY public.llm_skills.id;

CREATE TABLE public.notebook_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notebook_id uuid NOT NULL,
    file_id uuid NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.notebooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer NOT NULL,
    agent_id character varying(100),
    title character varying(512),
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    extra jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ocr_agent_configs (
    id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer,
    name character varying(200) NOT NULL,
    data_type_label character varying(100) DEFAULT ''::character varying NOT NULL,
    model character varying(200) DEFAULT ''::character varying NOT NULL,
    output_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.ocr_agent_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ocr_agent_configs_id_seq OWNED BY public.ocr_agent_configs.id;

CREATE TABLE public.ocr_extraction_history (
    id integer NOT NULL,
    config_id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer,
    filename character varying(500) DEFAULT ''::character varying NOT NULL,
    raw_text text DEFAULT ''::text NOT NULL,
    extracted_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'success'::character varying NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    model character varying(200),
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    latency_ms integer
);

CREATE SEQUENCE public.ocr_extraction_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ocr_extraction_history_id_seq OWNED BY public.ocr_extraction_history.id;

CREATE TABLE public.prompt_templates (
    id integer NOT NULL,
    user_id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    agent_id character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.prompt_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.prompt_templates_id_seq OWNED BY public.prompt_templates.id;

CREATE TABLE public.source_files (
    id integer NOT NULL,
    user_id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    agent_id character varying(100) NOT NULL,
    file_name character varying(255) NOT NULL,
    content text NOT NULL,
    is_selected boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.source_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.source_files_id_seq OWNED BY public.source_files.id;

CREATE TABLE public.stored_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id character varying(100) NOT NULL,
    uploaded_by_user_id integer,
    storage_backend character varying(32) DEFAULT 'local'::character varying NOT NULL,
    storage_rel_path text NOT NULL,
    original_filename character varying(512) NOT NULL,
    content_type character varying(255),
    size_bytes bigint NOT NULL,
    sha256_hex character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

CREATE TABLE public.tenant_agents (
    tenant_id character varying(100) NOT NULL,
    agent_id character varying(100) NOT NULL
);

CREATE TABLE public.tenant_configs (
    tenant_id character varying(100) NOT NULL,
    default_llm_provider character varying(50),
    default_llm_model character varying(255),
    embedding_provider character varying(50),
    embedding_model character varying(255),
    embedding_locked_at timestamp with time zone,
    embedding_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    speech_provider character varying(50),
    speech_base_url character varying(500),
    speech_api_key_encrypted text,
    speech_model character varying(255),
    analysis_llm_model character varying(255)
);

CREATE TABLE public.tenants (
    id character varying(100) NOT NULL,
    name character varying(255) NOT NULL
);

CREATE TABLE public.user_agents (
    tenant_id character varying(100) NOT NULL,
    user_id integer NOT NULL,
    agent_id character varying(100) NOT NULL
);

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    username character varying(100) NOT NULL,
    hashed_password character varying(255) NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying NOT NULL,
    tenant_id character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    display_name character varying(100),
    avatar_b64 text,
    allowed_models jsonb
);

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

CREATE TABLE public.writing_documents (
    id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    user_id integer,
    title character varying(200) NOT NULL,
    content text,
    user_prompt text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    draft text
);

CREATE SEQUENCE public.writing_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.writing_documents_id_seq OWNED BY public.writing_documents.id;

ALTER TABLE ONLY public.activation_codes ALTER COLUMN id SET DEFAULT nextval('public.activation_codes_id_seq'::regclass);

ALTER TABLE ONLY public.agent_usage_logs ALTER COLUMN id SET DEFAULT nextval('public.agent_usage_logs_id_seq'::regclass);

ALTER TABLE ONLY public.api_key_usages ALTER COLUMN id SET DEFAULT nextval('public.api_key_usages_id_seq'::regclass);

ALTER TABLE ONLY public.api_keys ALTER COLUMN id SET DEFAULT nextval('public.api_keys_id_seq'::regclass);

ALTER TABLE ONLY public.bot_widget_messages ALTER COLUMN id SET DEFAULT nextval('public.bot_widget_messages_id_seq'::regclass);

ALTER TABLE ONLY public.doc_image_configs ALTER COLUMN id SET DEFAULT nextval('public.doc_image_configs_id_seq'::regclass);

ALTER TABLE ONLY public.doc_image_history ALTER COLUMN id SET DEFAULT nextval('public.doc_image_history_id_seq'::regclass);

ALTER TABLE ONLY public.doc_parse_evaluation ALTER COLUMN id SET DEFAULT nextval('public.doc_parse_evaluation_id_seq'::regclass);

ALTER TABLE ONLY public.doc_parse_profiles ALTER COLUMN id SET DEFAULT nextval('public.doc_parse_profiles_id_seq'::regclass);

ALTER TABLE ONLY public.doc_parse_results ALTER COLUMN id SET DEFAULT nextval('public.doc_parse_results_id_seq'::regclass);

ALTER TABLE ONLY public.km_bot_faqs ALTER COLUMN id SET DEFAULT nextval('public.km_bot_faqs_id_seq'::regclass);

ALTER TABLE ONLY public.km_bots ALTER COLUMN id SET DEFAULT nextval('public.bots_id_seq'::regclass);

ALTER TABLE ONLY public.km_chunks ALTER COLUMN id SET DEFAULT nextval('public.km_chunks_id_seq'::regclass);

ALTER TABLE ONLY public.km_connectors ALTER COLUMN id SET DEFAULT nextval('public.km_connectors_id_seq'::regclass);

ALTER TABLE ONLY public.km_documents ALTER COLUMN id SET DEFAULT nextval('public.km_documents_id_seq'::regclass);

ALTER TABLE ONLY public.km_knowledge_bases ALTER COLUMN id SET DEFAULT nextval('public.km_knowledge_bases_id_seq'::regclass);

ALTER TABLE ONLY public.llm_provider_configs ALTER COLUMN id SET DEFAULT nextval('public.llm_provider_configs_id_seq'::regclass);

ALTER TABLE ONLY public.llm_skills ALTER COLUMN id SET DEFAULT nextval('public.llm_skills_id_seq'::regclass);

ALTER TABLE ONLY public.ocr_agent_configs ALTER COLUMN id SET DEFAULT nextval('public.ocr_agent_configs_id_seq'::regclass);

ALTER TABLE ONLY public.ocr_extraction_history ALTER COLUMN id SET DEFAULT nextval('public.ocr_extraction_history_id_seq'::regclass);

ALTER TABLE ONLY public.prompt_templates ALTER COLUMN id SET DEFAULT nextval('public.prompt_templates_id_seq'::regclass);

ALTER TABLE ONLY public.source_files ALTER COLUMN id SET DEFAULT nextval('public.source_files_id_seq'::regclass);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.writing_documents ALTER COLUMN id SET DEFAULT nextval('public.writing_documents_id_seq'::regclass);

ALTER TABLE ONLY public.activation_codes
    ADD CONSTRAINT activation_codes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_catalog
    ADD CONSTRAINT agent_catalog_pkey PRIMARY KEY (agent_id);

ALTER TABLE ONLY public.agent_usage_logs
    ADD CONSTRAINT agent_usage_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_key_usages
    ADD CONSTRAINT api_key_usages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bi_projects
    ADD CONSTRAINT bi_projects_pkey PRIMARY KEY (project_id);

ALTER TABLE ONLY public.bi_sample_qa
    ADD CONSTRAINT bi_sample_qa_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bi_schemas
    ADD CONSTRAINT bi_schemas_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bi_sources
    ADD CONSTRAINT bi_sources_pkey PRIMARY KEY (source_id);

ALTER TABLE ONLY public.bot_external_users
    ADD CONSTRAINT bot_external_users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.km_bot_kb
    ADD CONSTRAINT bot_knowledge_bases_pkey PRIMARY KEY (bot_id, knowledge_base_id);

ALTER TABLE ONLY public.bot_query_logs
    ADD CONSTRAINT bot_query_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bot_widget_messages
    ADD CONSTRAINT bot_widget_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bot_widget_sessions
    ADD CONSTRAINT bot_widget_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.km_bots
    ADD CONSTRAINT bots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.km_bots
    ADD CONSTRAINT bots_public_token_key UNIQUE (public_token);

ALTER TABLE ONLY public.chat_llm_requests
    ADD CONSTRAINT chat_llm_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chat_message_attachments
    ADD CONSTRAINT chat_message_attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chat_threads
    ADD CONSTRAINT chat_threads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.doc_image_configs
    ADD CONSTRAINT doc_image_configs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.doc_image_history
    ADD CONSTRAINT doc_image_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.doc_parse_evaluation
    ADD CONSTRAINT doc_parse_evaluation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.doc_parse_profiles
    ADD CONSTRAINT doc_parse_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.doc_parse_results
    ADD CONSTRAINT doc_parse_results_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.estimator_templates
    ADD CONSTRAINT estimator_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.km_bot_faqs
    ADD CONSTRAINT km_bot_faqs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.km_chunks
    ADD CONSTRAINT km_chunks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.km_connectors
    ADD CONSTRAINT km_connectors_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.km_documents
    ADD CONSTRAINT km_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.km_knowledge_bases
    ADD CONSTRAINT km_knowledge_bases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.km_query_logs
    ADD CONSTRAINT km_query_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.llm_provider_configs
    ADD CONSTRAINT llm_provider_configs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.llm_skills
    ADD CONSTRAINT llm_skills_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notebook_sources
    ADD CONSTRAINT notebook_sources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notebooks
    ADD CONSTRAINT notebooks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ocr_agent_configs
    ADD CONSTRAINT ocr_agent_configs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ocr_extraction_history
    ADD CONSTRAINT ocr_extraction_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompt_templates
    ADD CONSTRAINT prompt_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.source_files
    ADD CONSTRAINT source_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stored_files
    ADD CONSTRAINT stored_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stored_files
    ADD CONSTRAINT stored_files_storage_rel_path_key UNIQUE (storage_rel_path);

ALTER TABLE ONLY public.tenant_agents
    ADD CONSTRAINT tenant_agents_pkey PRIMARY KEY (tenant_id, agent_id);

ALTER TABLE ONLY public.tenant_configs
    ADD CONSTRAINT tenant_configs_pkey PRIMARY KEY (tenant_id);

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_key_usages
    ADD CONSTRAINT uq_api_key_usages_key_date UNIQUE (api_key_id, date);

ALTER TABLE ONLY public.bot_external_users
    ADD CONSTRAINT uq_bot_external_users_identity UNIQUE (bot_id, external_platform, external_user_id);

ALTER TABLE ONLY public.chat_message_attachments
    ADD CONSTRAINT uq_chat_message_attachments_message_file UNIQUE (message_id, file_id);

ALTER TABLE ONLY public.notebook_sources
    ADD CONSTRAINT uq_notebook_sources_notebook_file UNIQUE (notebook_id, file_id);

ALTER TABLE ONLY public.user_agents
    ADD CONSTRAINT user_agents_pkey PRIMARY KEY (tenant_id, user_id, agent_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.writing_documents
    ADD CONSTRAINT writing_documents_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX ix_activation_codes_code_hash ON public.activation_codes USING btree (code_hash);

CREATE INDEX ix_activation_codes_tenant_id ON public.activation_codes USING btree (tenant_id);

CREATE INDEX ix_agent_catalog_agent_id ON public.agent_catalog USING btree (agent_id);

CREATE INDEX ix_agent_catalog_group_id ON public.agent_catalog USING btree (group_id);

CREATE INDEX ix_agent_catalog_sort_id ON public.agent_catalog USING btree (sort_id);

CREATE INDEX ix_agent_usage_logs_agent_type ON public.agent_usage_logs USING btree (agent_type);

CREATE INDEX ix_agent_usage_logs_created_at ON public.agent_usage_logs USING btree (created_at);

CREATE INDEX ix_agent_usage_logs_tenant_id ON public.agent_usage_logs USING btree (tenant_id);

CREATE INDEX ix_api_key_usages_api_key_id ON public.api_key_usages USING btree (api_key_id);

CREATE INDEX ix_api_key_usages_date ON public.api_key_usages USING btree (date);

CREATE INDEX ix_api_keys_bot_id ON public.api_keys USING btree (bot_id);

CREATE UNIQUE INDEX ix_api_keys_key_hash ON public.api_keys USING btree (key_hash);

CREATE INDEX ix_api_keys_tenant_id ON public.api_keys USING btree (tenant_id);

CREATE INDEX ix_bi_projects_agent_id ON public.bi_projects USING btree (agent_id);

CREATE INDEX ix_bi_projects_tenant_id ON public.bi_projects USING btree (tenant_id);

CREATE INDEX ix_bi_projects_user_id ON public.bi_projects USING btree (user_id);

CREATE INDEX ix_bi_sample_qa_agent_id ON public.bi_sample_qa USING btree (agent_id);

CREATE INDEX ix_bi_sample_qa_tenant_id ON public.bi_sample_qa USING btree (tenant_id);

CREATE INDEX ix_bi_sample_qa_user_id ON public.bi_sample_qa USING btree (user_id);

CREATE INDEX ix_bi_schemas_agent_id ON public.bi_schemas USING btree (agent_id);

CREATE INDEX ix_bi_schemas_id ON public.bi_schemas USING btree (id);

CREATE INDEX ix_bi_schemas_user_id ON public.bi_schemas USING btree (user_id);

CREATE INDEX ix_bi_sources_project_id ON public.bi_sources USING btree (project_id);

CREATE INDEX ix_bi_sources_source_type ON public.bi_sources USING btree (source_type);

CREATE INDEX ix_bot_external_users_bot_id ON public.bot_external_users USING btree (bot_id);

CREATE INDEX ix_bot_external_users_last_seen_at ON public.bot_external_users USING btree (last_seen_at);

CREATE INDEX ix_bot_external_users_tenant_id ON public.bot_external_users USING btree (tenant_id);

CREATE INDEX ix_bot_query_logs_api_key_id ON public.bot_query_logs USING btree (api_key_id);

CREATE INDEX ix_bot_query_logs_bot_id ON public.bot_query_logs USING btree (bot_id);

CREATE INDEX ix_bot_query_logs_created_at ON public.bot_query_logs USING btree (created_at);

CREATE INDEX ix_bot_query_logs_external_user_fk ON public.bot_query_logs USING btree (external_user_fk);

CREATE INDEX ix_bot_query_logs_hit ON public.bot_query_logs USING btree (hit);

CREATE INDEX ix_bot_query_logs_tenant_id ON public.bot_query_logs USING btree (tenant_id);

CREATE INDEX ix_bot_widget_messages_external_user_fk ON public.bot_widget_messages USING btree (external_user_fk);

CREATE INDEX ix_bot_widget_messages_session_id ON public.bot_widget_messages USING btree (session_id);

CREATE INDEX ix_bot_widget_sessions_bot_id ON public.bot_widget_sessions USING btree (bot_id);

CREATE INDEX ix_chat_llm_requests_tenant_id ON public.chat_llm_requests USING btree (tenant_id);

CREATE INDEX ix_chat_llm_requests_thread_id ON public.chat_llm_requests USING btree (thread_id);

CREATE INDEX ix_chat_llm_requests_trace_id ON public.chat_llm_requests USING btree (trace_id);

CREATE INDEX ix_chat_llm_requests_user_id ON public.chat_llm_requests USING btree (user_id);

CREATE INDEX ix_chat_message_attachments_file_id ON public.chat_message_attachments USING btree (file_id);

CREATE INDEX ix_chat_message_attachments_message_id ON public.chat_message_attachments USING btree (message_id);

CREATE INDEX ix_chat_messages_llm_request_id ON public.chat_messages USING btree (llm_request_id);

CREATE INDEX ix_chat_messages_thread_id ON public.chat_messages USING btree (thread_id);

CREATE INDEX ix_chat_threads_agent_id ON public.chat_threads USING btree (agent_id);

CREATE INDEX ix_chat_threads_tenant_id ON public.chat_threads USING btree (tenant_id);

CREATE INDEX ix_chat_threads_user_id ON public.chat_threads USING btree (user_id);

CREATE INDEX ix_doc_image_configs_tenant_id ON public.doc_image_configs USING btree (tenant_id);

CREATE INDEX ix_doc_image_history_config_id ON public.doc_image_history USING btree (config_id);

CREATE INDEX ix_doc_image_history_tenant_id ON public.doc_image_history USING btree (tenant_id);

CREATE INDEX ix_doc_parse_eval_item_type ON public.doc_parse_evaluation USING btree (result_id, item_type);

CREATE INDEX ix_doc_parse_eval_result_id ON public.doc_parse_evaluation USING btree (result_id);

CREATE INDEX ix_doc_parse_evaluation_result_id ON public.doc_parse_evaluation USING btree (result_id);

CREATE UNIQUE INDEX ix_doc_parse_profiles_profile_id ON public.doc_parse_profiles USING btree (profile_id);

CREATE INDEX ix_doc_parse_profiles_tenant_id ON public.doc_parse_profiles USING btree (tenant_id);

CREATE INDEX ix_doc_parse_results_created_at ON public.doc_parse_results USING btree (created_at);

CREATE INDEX ix_doc_parse_results_profile_id ON public.doc_parse_results USING btree (profile_id);

CREATE INDEX ix_doc_parse_results_tenant_id ON public.doc_parse_results USING btree (tenant_id);

CREATE INDEX ix_doc_parse_results_user_id ON public.doc_parse_results USING btree (user_id);

CREATE INDEX ix_estimator_templates_tenant_id ON public.estimator_templates USING btree (tenant_id);

CREATE INDEX ix_estimator_templates_user_id ON public.estimator_templates USING btree (user_id);

CREATE INDEX ix_km_bot_faqs_bot_id ON public.km_bot_faqs USING btree (bot_id);

CREATE INDEX ix_km_bot_faqs_faq_type ON public.km_bot_faqs USING btree (faq_type);

CREATE INDEX ix_km_bot_faqs_id ON public.km_bot_faqs USING btree (id);

CREATE UNIQUE INDEX ix_km_bots_public_token ON public.km_bots USING btree (public_token);

CREATE INDEX ix_km_bots_tenant_id ON public.km_bots USING btree (tenant_id);

CREATE INDEX ix_km_chunks_content_tsv ON public.km_chunks USING gin (content_tsv);

CREATE INDEX ix_km_chunks_document_id ON public.km_chunks USING btree (document_id);

CREATE INDEX ix_km_connectors_id ON public.km_connectors USING btree (id);

CREATE INDEX ix_km_connectors_knowledge_base_id ON public.km_connectors USING btree (knowledge_base_id);

CREATE INDEX ix_km_connectors_source_type ON public.km_connectors USING btree (source_type);

CREATE INDEX ix_km_connectors_status ON public.km_connectors USING btree (status);

CREATE INDEX ix_km_connectors_tenant_id ON public.km_connectors USING btree (tenant_id);

CREATE INDEX ix_km_documents_knowledge_base_id ON public.km_documents USING btree (knowledge_base_id);

CREATE INDEX ix_km_documents_owner_user_id ON public.km_documents USING btree (owner_user_id);

CREATE INDEX ix_km_documents_tenant_id ON public.km_documents USING btree (tenant_id);

CREATE INDEX ix_km_knowledge_bases_tenant_id ON public.km_knowledge_bases USING btree (tenant_id);

CREATE INDEX ix_km_query_logs_created_at ON public.km_query_logs USING btree (created_at);

CREATE INDEX ix_km_query_logs_hit ON public.km_query_logs USING btree (hit);

CREATE INDEX ix_km_query_logs_knowledge_base_id ON public.km_query_logs USING btree (knowledge_base_id);

CREATE INDEX ix_km_query_logs_tenant_id ON public.km_query_logs USING btree (tenant_id);

CREATE INDEX ix_llm_provider_configs_is_active ON public.llm_provider_configs USING btree (is_active);

CREATE INDEX ix_llm_provider_configs_provider ON public.llm_provider_configs USING btree (provider);

CREATE INDEX ix_llm_provider_configs_tenant_id ON public.llm_provider_configs USING btree (tenant_id);

CREATE INDEX ix_llm_skills_tenant_id ON public.llm_skills USING btree (tenant_id);

CREATE INDEX ix_notebook_sources_file_id ON public.notebook_sources USING btree (file_id);

CREATE INDEX ix_notebook_sources_notebook_id ON public.notebook_sources USING btree (notebook_id);

CREATE INDEX ix_notebooks_agent_id ON public.notebooks USING btree (agent_id);

CREATE INDEX ix_notebooks_tenant_id ON public.notebooks USING btree (tenant_id);

CREATE INDEX ix_notebooks_user_id ON public.notebooks USING btree (user_id);

CREATE INDEX ix_ocr_agent_configs_tenant_id ON public.ocr_agent_configs USING btree (tenant_id);

CREATE INDEX ix_ocr_extraction_history_config_id ON public.ocr_extraction_history USING btree (config_id);

CREATE INDEX ix_ocr_extraction_history_tenant_id ON public.ocr_extraction_history USING btree (tenant_id);

CREATE INDEX ix_prompt_templates_agent_id ON public.prompt_templates USING btree (agent_id);

CREATE INDEX ix_prompt_templates_id ON public.prompt_templates USING btree (id);

CREATE INDEX ix_prompt_templates_tenant_id ON public.prompt_templates USING btree (tenant_id);

CREATE INDEX ix_prompt_templates_user_id ON public.prompt_templates USING btree (user_id);

CREATE INDEX ix_source_files_agent_id ON public.source_files USING btree (agent_id);

CREATE INDEX ix_source_files_id ON public.source_files USING btree (id);

CREATE INDEX ix_source_files_tenant_id ON public.source_files USING btree (tenant_id);

CREATE INDEX ix_source_files_user_id ON public.source_files USING btree (user_id);

CREATE INDEX ix_stored_files_tenant_id ON public.stored_files USING btree (tenant_id);

CREATE INDEX ix_stored_files_uploaded_by_user_id ON public.stored_files USING btree (uploaded_by_user_id);

CREATE INDEX ix_tenants_id ON public.tenants USING btree (id);

CREATE INDEX ix_user_agents_tenant_id ON public.user_agents USING btree (tenant_id);

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);

CREATE INDEX ix_users_id ON public.users USING btree (id);

CREATE INDEX ix_users_tenant_id ON public.users USING btree (tenant_id);

CREATE UNIQUE INDEX ix_users_username ON public.users USING btree (username);

CREATE INDEX ix_writing_documents_tenant_id ON public.writing_documents USING btree (tenant_id);

CREATE INDEX ix_writing_documents_user_id ON public.writing_documents USING btree (user_id);

CREATE INDEX km_chunks_embedding_hnsw ON public.km_chunks USING hnsw (embedding public.vector_cosine_ops);

ALTER TABLE ONLY public.activation_codes
    ADD CONSTRAINT activation_codes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_usage_logs
    ADD CONSTRAINT agent_usage_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.agent_usage_logs
    ADD CONSTRAINT agent_usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.api_key_usages
    ADD CONSTRAINT api_key_usages_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_bot_id_fkey FOREIGN KEY (bot_id) REFERENCES public.km_bots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bi_projects
    ADD CONSTRAINT bi_projects_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.bi_sample_qa
    ADD CONSTRAINT bi_sample_qa_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.bi_schemas
    ADD CONSTRAINT bi_schemas_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bi_sources
    ADD CONSTRAINT bi_sources_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.bi_projects(project_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_external_users
    ADD CONSTRAINT bot_external_users_bot_id_fkey FOREIGN KEY (bot_id) REFERENCES public.km_bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_external_users
    ADD CONSTRAINT bot_external_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.km_bot_kb
    ADD CONSTRAINT bot_knowledge_bases_bot_id_fkey FOREIGN KEY (bot_id) REFERENCES public.km_bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.km_bot_kb
    ADD CONSTRAINT bot_knowledge_bases_knowledge_base_id_fkey FOREIGN KEY (knowledge_base_id) REFERENCES public.km_knowledge_bases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_query_logs
    ADD CONSTRAINT bot_query_logs_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_query_logs
    ADD CONSTRAINT bot_query_logs_bot_id_fkey FOREIGN KEY (bot_id) REFERENCES public.km_bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_query_logs
    ADD CONSTRAINT bot_query_logs_external_user_fk_fkey FOREIGN KEY (external_user_fk) REFERENCES public.bot_external_users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_query_logs
    ADD CONSTRAINT bot_query_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.bot_widget_sessions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_query_logs
    ADD CONSTRAINT bot_query_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.bot_widget_messages
    ADD CONSTRAINT bot_widget_messages_external_user_fk_fkey FOREIGN KEY (external_user_fk) REFERENCES public.bot_external_users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_widget_messages
    ADD CONSTRAINT bot_widget_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.bot_widget_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_widget_sessions
    ADD CONSTRAINT bot_widget_sessions_bot_id_fkey FOREIGN KEY (bot_id) REFERENCES public.km_bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.km_bots
    ADD CONSTRAINT bots_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.chat_llm_requests
    ADD CONSTRAINT chat_llm_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.chat_llm_requests
    ADD CONSTRAINT chat_llm_requests_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.chat_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_llm_requests
    ADD CONSTRAINT chat_llm_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.chat_message_attachments
    ADD CONSTRAINT chat_message_attachments_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.stored_files(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.chat_message_attachments
    ADD CONSTRAINT chat_message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_llm_request_id_fkey FOREIGN KEY (llm_request_id) REFERENCES public.chat_llm_requests(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.chat_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_threads
    ADD CONSTRAINT chat_threads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.chat_threads
    ADD CONSTRAINT chat_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.doc_image_configs
    ADD CONSTRAINT doc_image_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.doc_image_configs
    ADD CONSTRAINT doc_image_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.doc_image_history
    ADD CONSTRAINT doc_image_history_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.doc_image_configs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.doc_parse_evaluation
    ADD CONSTRAINT doc_parse_evaluation_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.doc_parse_results(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.doc_parse_results
    ADD CONSTRAINT doc_parse_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.estimator_templates
    ADD CONSTRAINT estimator_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.estimator_templates
    ADD CONSTRAINT estimator_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.km_bot_faqs
    ADD CONSTRAINT km_bot_faqs_bot_id_fkey FOREIGN KEY (bot_id) REFERENCES public.km_bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.km_chunks
    ADD CONSTRAINT km_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.km_documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.km_connectors
    ADD CONSTRAINT km_connectors_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.km_connectors
    ADD CONSTRAINT km_connectors_knowledge_base_id_fkey FOREIGN KEY (knowledge_base_id) REFERENCES public.km_knowledge_bases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.km_connectors
    ADD CONSTRAINT km_connectors_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.km_documents
    ADD CONSTRAINT km_documents_knowledge_base_id_fkey FOREIGN KEY (knowledge_base_id) REFERENCES public.km_knowledge_bases(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.km_documents
    ADD CONSTRAINT km_documents_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.km_documents
    ADD CONSTRAINT km_documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.km_knowledge_bases
    ADD CONSTRAINT km_knowledge_bases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.km_query_logs
    ADD CONSTRAINT km_query_logs_chat_thread_id_fkey FOREIGN KEY (chat_thread_id) REFERENCES public.chat_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.km_query_logs
    ADD CONSTRAINT km_query_logs_knowledge_base_id_fkey FOREIGN KEY (knowledge_base_id) REFERENCES public.km_knowledge_bases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.km_query_logs
    ADD CONSTRAINT km_query_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.km_query_logs
    ADD CONSTRAINT km_query_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.llm_provider_configs
    ADD CONSTRAINT llm_provider_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.llm_skills
    ADD CONSTRAINT llm_skills_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.llm_skills
    ADD CONSTRAINT llm_skills_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notebook_sources
    ADD CONSTRAINT notebook_sources_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.stored_files(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.notebook_sources
    ADD CONSTRAINT notebook_sources_notebook_id_fkey FOREIGN KEY (notebook_id) REFERENCES public.notebooks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.notebooks
    ADD CONSTRAINT notebooks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.notebooks
    ADD CONSTRAINT notebooks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ocr_agent_configs
    ADD CONSTRAINT ocr_agent_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ocr_agent_configs
    ADD CONSTRAINT ocr_agent_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ocr_extraction_history
    ADD CONSTRAINT ocr_extraction_history_config_id_fkey FOREIGN KEY (config_id) REFERENCES public.ocr_agent_configs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_templates
    ADD CONSTRAINT prompt_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.prompt_templates
    ADD CONSTRAINT prompt_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_files
    ADD CONSTRAINT source_files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.source_files
    ADD CONSTRAINT source_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.stored_files
    ADD CONSTRAINT stored_files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.stored_files
    ADD CONSTRAINT stored_files_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.tenant_agents
    ADD CONSTRAINT tenant_agents_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agent_catalog(agent_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tenant_agents
    ADD CONSTRAINT tenant_agents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tenant_configs
    ADD CONSTRAINT tenant_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_agents
    ADD CONSTRAINT user_agents_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agent_catalog(agent_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_agents
    ADD CONSTRAINT user_agents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.user_agents
    ADD CONSTRAINT user_agents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.writing_documents
    ADD CONSTRAINT writing_documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.writing_documents
    ADD CONSTRAINT writing_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    """)


def downgrade():
    pass
