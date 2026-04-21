"""Add tenant_configs table with default LLM and embedding settings

Revision ID: 010_tenant_configs
Revises: 009_embedding_dim_768
Create Date: 2026-04-21
"""
import sqlalchemy as sa
from alembic import op

revision = "010_tenant_configs"
down_revision = "009_embedding_dim_768"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tenant_configs",
        sa.Column("tenant_id", sa.String(100), sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("default_llm_provider", sa.String(50), nullable=True),
        sa.Column("default_llm_model", sa.String(255), nullable=True),
        sa.Column("embedding_provider", sa.String(50), nullable=False, server_default="openai"),
        sa.Column("embedding_model", sa.String(255), nullable=False, server_default="text-embedding-3-small"),
        sa.Column("embedding_locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("embedding_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Data migration：為現有 tenant 建立預設設定列
    # default_llm_model 從 llm_provider_configs 取優先順序最高的那筆（gemini > openai > twcc > local）
    op.execute("""
        INSERT INTO tenant_configs (
            tenant_id,
            default_llm_provider,
            default_llm_model,
            embedding_provider,
            embedding_model,
            embedding_locked_at,
            embedding_version
        )
        SELECT
            t.id AS tenant_id,
            best.provider AS default_llm_provider,
            best.default_model AS default_llm_model,
            'openai' AS embedding_provider,
            'text-embedding-3-small' AS embedding_model,
            NULL AS embedding_locked_at,
            1 AS embedding_version
        FROM tenants t
        LEFT JOIN LATERAL (
            SELECT provider, default_model
            FROM llm_provider_configs
            WHERE tenant_id = t.id
              AND is_active = true
              AND default_model IS NOT NULL
            ORDER BY
                CASE provider
                    WHEN 'gemini' THEN 1
                    WHEN 'openai' THEN 2
                    WHEN 'twcc'   THEN 3
                    WHEN 'local'  THEN 4
                    ELSE 5
                END
            LIMIT 1
        ) best ON true
        ON CONFLICT (tenant_id) DO NOTHING
    """)

    # 若有 tenant 有 km_chunks 但 embedding_locked_at 還是 null，補上鎖定時間
    op.execute("""
        UPDATE tenant_configs tc
        SET embedding_locked_at = NOW()
        WHERE EXISTS (
            SELECT 1
            FROM km_documents kd
            JOIN km_chunks kc ON kc.document_id = kd.id
            WHERE kd.tenant_id = tc.tenant_id
              AND kc.embedding IS NOT NULL
        )
        AND tc.embedding_locked_at IS NULL
    """)


def downgrade():
    op.drop_table("tenant_configs")
