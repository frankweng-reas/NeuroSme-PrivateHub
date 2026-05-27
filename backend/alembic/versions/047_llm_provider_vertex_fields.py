"""047_llm_provider_vertex_fields

Revision ID: 047
Revises: 046
Create Date: 2026-05-27

llm_provider_configs 新增 gcp_project_id / gcp_region：支援 Google Vertex AI provider
"""
from alembic import op
import sqlalchemy as sa

revision = '047'
down_revision = '046'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('llm_provider_configs', sa.Column('gcp_project_id', sa.String(255), nullable=True))
    op.add_column('llm_provider_configs', sa.Column('gcp_region', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('llm_provider_configs', 'gcp_region')
    op.drop_column('llm_provider_configs', 'gcp_project_id')
