"""啟動時自動同步基礎資料。

執行順序（main.py lifespan）：
  1. seed_agent_catalog   — upsert 產品內建 agents（所有環境）
  2. seed_default_tenant  — 若 tenants 為空，建立預設 tenant（所有環境）
  3. seed_default_admin   — 若 users 為空，建立預設 admin 帳號（所有環境）
"""
import logging
import secrets

from sqlalchemy.orm import Session

from app.core.agent_catalog_defs import BUILTIN_AGENTS
from app.models.agent_catalog import AgentCatalog
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
