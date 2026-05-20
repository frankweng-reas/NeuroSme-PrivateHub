"""034 create doc_parse_profiles and seed tender-gov-tw

Revision ID: 034
Revises: 033
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
import json

revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None

_TENDER_GOV_TW = {
    "sections": [
        {
            "id": "basic",
            "label": "基本資訊",
            "fields": [
                {"key": "case_no",    "label": "案號",       "type": "text",     "hint": "招標案號，通常位於首頁標題或招標文件首頁，格式如「113-XXX」或「採購字第XXX號」"},
                {"key": "agency",     "label": "招標機關",   "type": "text",     "hint": "辦理採購的政府機關名稱，通常在首頁或機關資料欄"},
                {"key": "case_name",  "label": "案名",       "type": "text",     "hint": "採購案正式名稱，通常在首頁最顯著位置"},
                {"key": "deadline",   "label": "投標截止日", "type": "datetime", "hint": "投標或領標截止的日期與時間，格式如「民國XXX年X月X日 XX:XX」或「XXXX/XX/XX XX:XX」"},
                {"key": "open_date",  "label": "開標日",     "type": "datetime", "hint": "公開開標的日期與時間"},
                {"key": "contact",    "label": "聯絡方式",   "type": "text",     "hint": "承辦人員姓名、電話、傳真、電子信箱等聯絡資訊"},
            ],
        },
        {
            "id": "financial",
            "label": "金額門檻",
            "fields": [
                {"key": "budget",           "label": "預算金額",   "type": "currency", "hint": "本採購案的預算總金額，可能含稅或未稅，請注意單位（元、萬元）"},
                {"key": "guarantee_bond",   "label": "押標金",     "type": "currency", "hint": "投標所需繳交的押標金金額，可能為固定金額或預算百分比"},
                {"key": "performance_bond", "label": "履約保證金", "type": "currency", "hint": "得標後須繳交的履約保證金金額或契約金額的百分比"},
            ],
        },
        {
            "id": "qualification",
            "label": "資格條件",
            "fields": [
                {"key": "vendor_qualification", "label": "廠商資格", "type": "text_list", "hint": "投標廠商須符合的資格條件清單，如登記證明、經歷、財務等"},
                {"key": "prohibition",          "label": "禁止條件", "type": "text_list", "hint": "不得參與投標的條件，如政府採購法第103條停權、負責人同一等"},
                {"key": "joint_bid",            "label": "共同投標", "type": "text",      "hint": "是否允許共同投標、聯合投標、分包等規定"},
            ],
        },
        {
            "id": "evaluation",
            "label": "評選方式",
            "fields": [
                {"key": "eval_method", "label": "決標方式", "type": "text",      "hint": "最有利標、最低標、固定費用最優服務、或其他決標方式"},
                {"key": "eval_items",  "label": "評分項目", "type": "text_list", "hint": "評選評分項目名稱與各項配分比重，如「技術能力50分、價格30分…」"},
            ],
        },
        {
            "id": "delivery",
            "label": "履約交付",
            "fields": [
                {"key": "contract_period",    "label": "履約期限", "type": "text", "hint": "合約執行期間或完成天數，如「12個月」或「自通知日起180天內完成」"},
                {"key": "delivery_location",  "label": "交付地點", "type": "text", "hint": "服務提供地點或貨品交付地點"},
                {"key": "acceptance",         "label": "驗收規定", "type": "text", "hint": "驗收方式、驗收期限、驗收基準等"},
            ],
        },
        {
            "id": "documents",
            "label": "應備文件",
            "fields": [
                {"key": "required_docs", "label": "投標文件清單", "type": "text_list", "hint": "投標時須檢附的所有文件名稱清單，並標注是否為必要文件（強制檢附）"},
            ],
        },
        {
            "id": "tech",
            "label": "技術重點",
            "fields": [
                {"key": "tech_highlights", "label": "技術規範重點", "type": "text_list", "hint": "技術規格或特殊要求的重點條文，請附對應章節或頁碼引用"},
            ],
        },
        {
            "id": "risk",
            "label": "風險注意",
            "fields": [
                {"key": "risk_items", "label": "風險與注意事項", "type": "text_list", "hint": "模糊條文、高風險約定、對廠商不利條款、或需特別注意的事項"},
            ],
        },
    ]
}


def upgrade():
    op.create_table(
        "doc_parse_profiles",
        sa.Column("id",           sa.Integer(),     primary_key=True, autoincrement=True),
        sa.Column("profile_id",   sa.String(80),    nullable=False, unique=True, index=True),
        sa.Column("profile_name", sa.String(200),   nullable=False),
        sa.Column("tenant_id",    sa.String(),      nullable=True,  index=True),
        sa.Column("definition",   JSONB(),          nullable=False),
        sa.Column("is_active",    sa.Boolean(),     nullable=False, server_default=sa.text("true")),
        sa.Column("created_at",   sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at",   sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Seed 內建 profile
    definition_json = json.dumps(_TENDER_GOV_TW, ensure_ascii=False).replace("'", "''")
    op.execute(
        sa.text(
            f"INSERT INTO doc_parse_profiles (profile_id, profile_name, tenant_id, definition, is_active) "
            f"VALUES ('tender-gov-tw', '標案解析（政府採購）', NULL, '{definition_json}'::jsonb, true) "
            f"ON CONFLICT (profile_id) DO NOTHING"
        )
    )


def downgrade():
    op.drop_table("doc_parse_profiles")
