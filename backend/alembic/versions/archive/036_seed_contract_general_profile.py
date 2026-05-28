"""036 seed contract-general parse profile

Revision ID: 036
Revises: 035
Create Date: 2026-05-20
"""
import json
import sqlalchemy as sa
from alembic import op

revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None

_CONTRACT_GENERAL = {
    "sections": [
        {
            "id": "basic",
            "label": "基本資訊",
            "fields": [
                {"key": "contract_title",   "label": "合約名稱",   "type": "text",     "hint": "合約正式名稱，通常位於首頁標題"},
                {"key": "contract_number",  "label": "合約編號",   "type": "text",     "hint": "合約編號或文號，格式如「XXX字第XXX號」或「合約號：XXX」"},
                {"key": "sign_date",        "label": "簽約日期",   "type": "datetime", "hint": "雙方簽署合約的日期"},
                {"key": "effective_date",   "label": "生效日期",   "type": "datetime", "hint": "合約正式生效的日期，若無另行約定則以簽約日為準"},
                {"key": "expiry_date",      "label": "到期日期",   "type": "datetime", "hint": "合約期滿或終止日期"},
            ],
        },
        {
            "id": "parties",
            "label": "當事人",
            "fields": [
                {"key": "party_a",                  "label": "甲方",         "type": "text", "hint": "委託方或買方的正式名稱（公司名稱或機關名稱）"},
                {"key": "party_a_representative",   "label": "甲方代表人",   "type": "text", "hint": "甲方法定代理人或授權簽約人姓名及職稱"},
                {"key": "party_b",                  "label": "乙方",         "type": "text", "hint": "承接方或賣方的正式名稱（公司名稱）"},
                {"key": "party_b_representative",   "label": "乙方代表人",   "type": "text", "hint": "乙方法定代理人或授權簽約人姓名及職稱"},
            ],
        },
        {
            "id": "financial",
            "label": "金額與付款",
            "fields": [
                {"key": "contract_amount",  "label": "合約金額",   "type": "currency", "hint": "合約總價金，注意是否含稅及幣別"},
                {"key": "payment_terms",    "label": "付款條件",   "type": "text",     "hint": "付款方式，如預付款比例、里程碑付款、驗收後付款等"},
                {"key": "payment_schedule", "label": "付款時程",   "type": "text_list","hint": "各期付款時間點與金額或比例的條列清單"},
                {"key": "tax",              "label": "稅務約定",   "type": "text",     "hint": "稅別（營業稅、預扣稅等）及由哪方負擔"},
            ],
        },
        {
            "id": "scope",
            "label": "工作範圍",
            "fields": [
                {"key": "work_scope",       "label": "工作項目",   "type": "text_list","hint": "乙方須提供的服務、貨品或工程項目清單"},
                {"key": "deliverables",     "label": "交付成果",   "type": "text_list","hint": "合約要求交付的文件、系統、產品等具體成果"},
                {"key": "delivery_deadline","label": "交付期限",   "type": "text",     "hint": "各工作項目或最終成果的完成期限"},
                {"key": "place",            "label": "履約地點",   "type": "text",     "hint": "服務提供地點或交貨地點"},
            ],
        },
        {
            "id": "penalty",
            "label": "違約與罰則",
            "fields": [
                {"key": "penalty_clause",   "label": "違約罰則",   "type": "text_list","hint": "遲延履行、品質不符等違約情形的罰款金額或計算方式"},
                {"key": "force_majeure",    "label": "不可抗力",   "type": "text",     "hint": "不可抗力事件的定義及免責規定"},
                {"key": "warranty",         "label": "保固條款",   "type": "text",     "hint": "保固期間、保固範圍及保固責任"},
            ],
        },
        {
            "id": "termination",
            "label": "終止條款",
            "fields": [
                {"key": "termination_conditions","label": "終止條件", "type": "text_list","hint": "合約得提前終止的情形與條件"},
                {"key": "notice_period",         "label": "通知期限", "type": "text",     "hint": "終止合約須提前告知的天數或方式"},
                {"key": "termination_effect",    "label": "終止效果", "type": "text",     "hint": "合約終止後雙方的權利義務，如已完成工作的費用結算方式"},
            ],
        },
        {
            "id": "ip_confidential",
            "label": "智慧財產與保密",
            "fields": [
                {"key": "ip_ownership",     "label": "著作權歸屬", "type": "text",     "hint": "合約產出物的著作權或智慧財產權歸屬（甲方、乙方或共有）"},
                {"key": "confidentiality",  "label": "保密義務",   "type": "text",     "hint": "保密範圍、保密期間及違反保密的責任"},
            ],
        },
        {
            "id": "dispute",
            "label": "爭議解決",
            "fields": [
                {"key": "governing_law",    "label": "準據法",       "type": "text", "hint": "合約適用的法律（如中華民國法律）"},
                {"key": "jurisdiction",     "label": "管轄法院",     "type": "text", "hint": "約定的第一審管轄法院"},
                {"key": "dispute_resolution","label": "爭議解決方式","type": "text", "hint": "訴訟、仲裁或調解等爭議解決機制的約定"},
            ],
        },
        {
            "id": "risk",
            "label": "風險注意",
            "fields": [
                {"key": "risk_items", "label": "風險與注意事項", "type": "text_list",
                 "hint": "對乙方不利的條款、模糊約定、高風險事項或需特別注意的條文"},
            ],
        },
    ]
}


def upgrade() -> None:
    definition_json = json.dumps(_CONTRACT_GENERAL, ensure_ascii=False).replace("'", "''")
    op.execute(
        sa.text(
            f"INSERT INTO doc_parse_profiles (profile_id, profile_name, tenant_id, definition, is_active) "
            f"VALUES ('contract-general', '合約解析（通用）', NULL, '{definition_json}'::jsonb, true) "
            f"ON CONFLICT (profile_id) DO NOTHING"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM doc_parse_profiles WHERE profile_id = 'contract-general'")
    )
