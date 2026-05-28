"""037 create doc_parse_evaluation table

Revision ID: 037
Revises: 036
Create Date: 2026-05-20
"""
import sqlalchemy as sa
from alembic import op

revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "doc_parse_evaluation",
        sa.Column("id",          sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column("result_id",   sa.Integer(),
                  sa.ForeignKey("doc_parse_results.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        # "doc_checklist" | "tech_matrix"
        sa.Column("item_type",   sa.String(20),    nullable=False),
        sa.Column("item_key",    sa.String(500),   nullable=False),   # 文件名稱 or 規格描述
        sa.Column("cite",        sa.Text(),        nullable=True),    # 原文依據
        sa.Column("sort_order",  sa.Integer(),     nullable=False, server_default="0"),

        # ── doc_checklist 欄位 ──────────────────────────────────────────
        # mandatory: true=必附  false=選附  NULL=待分類
        sa.Column("mandatory",   sa.Boolean(),     nullable=True),
        sa.Column("assignee",    sa.String(200),   nullable=True),
        sa.Column("due_date",    sa.Date(),        nullable=True),
        # status: "todo" | "in_progress" | "done"
        sa.Column("status",      sa.String(20),    nullable=True, server_default="'todo'"),

        # ── tech_matrix 欄位 ────────────────────────────────────────────
        # capability: "meet" | "custom" | "outsource" | "unknown"
        sa.Column("capability",  sa.String(20),    nullable=True),
        # risk_level: "high" | "medium" | "low"
        sa.Column("risk_level",  sa.String(10),    nullable=True),

        # ── 共用 ────────────────────────────────────────────────────────
        sa.Column("note",        sa.Text(),        nullable=True),
        sa.Column("created_at",  sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at",  sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_doc_parse_eval_result_id",  "doc_parse_evaluation", ["result_id"])
    op.create_index("ix_doc_parse_eval_item_type",  "doc_parse_evaluation", ["result_id", "item_type"])


def downgrade() -> None:
    op.drop_index("ix_doc_parse_eval_item_type",  "doc_parse_evaluation")
    op.drop_index("ix_doc_parse_eval_result_id",  "doc_parse_evaluation")
    op.drop_table("doc_parse_evaluation")
