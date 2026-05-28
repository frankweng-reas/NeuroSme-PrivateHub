"""啟動時自動同步基礎資料。

執行順序（main.py lifespan）：
  1. seed_agent_catalog      — upsert 產品內建 agents（所有環境）
  2. seed_default_tenant     — 若 tenants 為空，建立預設 tenant（所有環境）
  3. seed_default_admin      — 若 users 為空，建立預設 admin 帳號（所有環境）
  4. seed_doc_parse_profiles — upsert 系統內建解析 profiles（所有環境）
"""
import logging
import secrets

from sqlalchemy.orm import Session

from app.core.agent_catalog_defs import BUILTIN_AGENTS
from app.models.agent_catalog import AgentCatalog
from app.models.doc_parse_profile import DocParseProfile
from app.models.tenant import Tenant
from app.models.tenant_agent import TenantAgent
from app.models.user import User

logger = logging.getLogger(__name__)

DEFAULT_TENANT_ID = "default"
DEFAULT_TENANT_NAME = "Default"
DEFAULT_ADMIN_EMAIL = "admin@local.dev"


def seed_agent_catalog(db: Session) -> None:
    """將 BUILTIN_AGENTS 的定義 upsert 進 agent_catalog。

    - 已存在的 agent：更新所有欄位（名稱、分組、icon、router 等）
    - 不存在的 agent：新增
    - DB 中已存在但不在 BUILTIN_AGENTS 的 agent：保留不動（允許手動新增的自訂 agent）
    """
    upserted = 0
    for agent_def in BUILTIN_AGENTS:
        existing = db.get(AgentCatalog, agent_def["agent_id"])
        if existing:
            existing.sort_id = agent_def["sort_id"]
            existing.group_id = agent_def["group_id"]
            existing.group_name = agent_def["group_name"]
            existing.agent_name = agent_def["agent_name"]
            existing.icon_name = agent_def["icon_name"]
            existing.backend_router = agent_def["backend_router"]
            existing.frontend_key = agent_def["frontend_key"]
        else:
            db.add(AgentCatalog(**agent_def))
        upserted += 1
    db.commit()
    logger.info("[startup_seed] agent_catalog upserted %d agents", upserted)


def seed_default_tenant(db: Session) -> None:
    """若 tenants 表為空，建立預設 tenant。

    on-prem 全新安裝時確保系統可以正常登入，不影響已有資料的環境。
    """
    if db.query(Tenant).first():
        return
    db.add(Tenant(id=DEFAULT_TENANT_ID, name=DEFAULT_TENANT_NAME))
    db.commit()
    logger.info("[startup_seed] 建立預設 tenant: id=%s", DEFAULT_TENANT_ID)


def seed_default_admin(db: Session) -> None:
    """若 users 表為空，建立預設 admin 帳號。

    email 與 LocalAuth 預設帳號 (admin@local.dev) 對齊，
    使用者第一次透過 LocalAuth 登入時，get_current_user 會找到此筆記錄
    並以 admin 身份進入系統，無需再手動升權。
    密碼由 LocalAuth 管理，hashed_password 僅為佔位用。
    """
    if db.query(User).first():
        return
    db.add(User(
        email=DEFAULT_ADMIN_EMAIL,
        username="admin",
        hashed_password=f"localauth_{secrets.token_hex(16)}",
        role="admin",
        tenant_id=DEFAULT_TENANT_ID,
    ))
    db.commit()
    logger.info("[startup_seed] 建立預設 admin: email=%s", DEFAULT_ADMIN_EMAIL)


def seed_tenant_agents(
    db: Session,
    enabled_agent_ids: list[str],
    tenant_ids: list[str] | None = None,
) -> None:
    """依 enabled_agent_ids 同步 tenant_agents。

    tenant_ids 為 None 時同步所有 tenant（啟動時用）；
    指定 tenant_ids 時只更新那幾個 tenant（Activation Code 兌換時用）。
    只處理 agent_catalog 中存在的 agent_id，無效 id 會被忽略並警告。
    """
    valid_ids: set[str] = {
        r.agent_id for r in db.query(AgentCatalog.agent_id).all()
    }
    enabled: list[str] = []
    for aid in enabled_agent_ids:
        if aid in valid_ids:
            enabled.append(aid)
        else:
            logger.warning(
                "[startup_seed] '%s' 不存在於 agent_catalog，已略過",
                aid,
            )

    if tenant_ids is not None:
        tenants = db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()
    else:
        tenants = db.query(Tenant).all()

    if not tenants:
        logger.warning("[startup_seed] 尚無任何 tenant，tenant_agents 同步略過")
        return

    for tenant in tenants:
        db.query(TenantAgent).filter(TenantAgent.tenant_id == tenant.id).delete()
        for aid in enabled:
            db.add(TenantAgent(tenant_id=tenant.id, agent_id=aid))

    db.commit()
    logger.info(
        "[startup_seed] tenant_agents synced: %d agent(s) × %d tenant(s)",
        len(enabled),
        len(tenants),
    )


# ── 系統內建 Doc Parse Profiles ───────────────────────────────────────────────

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
                {"key": "penalty_clause",   "label": "違約罰則",   "type": "text_list", "hint": "遲延履行、品質不符等違約情形的罰款金額或計算方式"},
                {"key": "force_majeure",    "label": "不可抗力",   "type": "text",      "hint": "不可抗力事件的定義及免責規定"},
                {"key": "warranty",         "label": "保固條款",   "type": "text",      "hint": "保固期間、保固範圍及保固責任"},
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
                {"key": "ip_ownership",     "label": "著作權歸屬", "type": "text", "hint": "合約產出物的著作權或智慧財產權歸屬（甲方、乙方或共有）"},
                {"key": "confidentiality",  "label": "保密義務",   "type": "text", "hint": "保密範圍、保密期間及違反保密的責任"},
            ],
        },
        {
            "id": "dispute",
            "label": "爭議解決",
            "fields": [
                {"key": "governing_law",     "label": "準據法",        "type": "text", "hint": "合約適用的法律（如中華民國法律）"},
                {"key": "jurisdiction",      "label": "管轄法院",      "type": "text", "hint": "約定的第一審管轄法院"},
                {"key": "dispute_resolution","label": "爭議解決方式",  "type": "text", "hint": "訴訟、仲裁或調解等爭議解決機制的約定"},
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

_BUILTIN_DOC_PARSE_PROFILES = [
    {
        "profile_id":   "tender-gov-tw",
        "profile_name": "標案解析（政府採購）",
        "definition":   _TENDER_GOV_TW,
    },
    {
        "profile_id":   "contract-general",
        "profile_name": "合約解析（通用）",
        "definition":   _CONTRACT_GENERAL,
    },
]


def seed_doc_parse_profiles(db: Session) -> None:
    """Upsert 系統內建 doc_parse_profiles（tenant_id = None 的共用 profiles）。

    - 已存在的 profile：更新 profile_name 與 definition
    - 不存在的 profile：新增
    - DB 中已存在但不在清單的 profile：保留不動（允許手動新增的自訂 profile）
    """
    upserted = 0
    for p in _BUILTIN_DOC_PARSE_PROFILES:
        existing = (
            db.query(DocParseProfile)
            .filter(DocParseProfile.profile_id == p["profile_id"])
            .first()
        )
        if existing:
            existing.profile_name = p["profile_name"]
            existing.definition   = p["definition"]
        else:
            db.add(DocParseProfile(
                profile_id=p["profile_id"],
                profile_name=p["profile_name"],
                tenant_id=None,
                definition=p["definition"],
                is_active=True,
            ))
        upserted += 1
    db.commit()
    logger.info("[startup_seed] doc_parse_profiles upserted %d profiles", upserted)
