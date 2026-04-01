"""Agents API：GET /agents/ 列表、GET /agents/{id} 單筆；需登入，依 agent_catalog + tenant_agents + user_agents 過濾"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent_catalog import AgentCatalog
from app.models.tenant_agent import TenantAgent
from app.models.user import User
from app.schemas.agent import AgentResponse
from app.services.permission import get_agent_ids_for_user, resolve_agent_catalog

router = APIRouter()


def _parse_agent_id(agent_id: str, fallback_tenant_id: str) -> tuple[str, str]:
    """解析 agent_id：支援 tenant_id:id 或 僅 id（用 fallback_tenant_id）"""
    if ":" in agent_id:
        tenant_id, aid = agent_id.split(":", 1)
        return tenant_id, aid
    return fallback_tenant_id, agent_id


def _get_tenant_purchased_semantic_agent_ids(db: Session, tenant_id: str) -> set[str]:
    """回傳該 tenant 已購買的 **業務 agent_id**（tenant_agents.agent_id = agent_catalog.agent_id）"""
    rows = db.query(TenantAgent.agent_id).filter(TenantAgent.tenant_id == tenant_id).all()
    return {r.agent_id for r in rows}


def _catalog_rows_for_semantic_agent_ids(db: Session, semantic_ids: set[str]) -> list[AgentCatalog]:
    """依業務 agent_id 查 catalog；ids 為空時不回傳全表。"""
    if not semantic_ids:
        return []
    return (
        db.query(AgentCatalog)
        .filter(AgentCatalog.agent_id.in_(semantic_ids))
        .order_by(
            AgentCatalog.sort_id.asc().nulls_last(),
            AgentCatalog.agent_id.asc(),
        )
        .all()
    )


@router.get("/", response_model=list[AgentResponse])
def list_agents(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
    is_purchased: str | None = Query(None, description="傳 'true' 則只回傳 tenant 已購買的 agents（供 admin 權限設定用）"),
    target_tenant_id: str | None = Query(None, description="admin 指定查詢的 tenant（不傳則用自己的 tenant）"),
):
    """取得 agents 列表。admin 且 is_purchased 時回傳指定 tenant 已購買的 agents；否則依 user_agents ∩ tenant_agents 過濾"""
    user = current
    if is_purchased and str(is_purchased).lower() == "true" and user.role in ("admin", "super_admin"):
        # admin 權限設定：依指定的 tenant_id（或自己的 tenant）查詢已購買 agents
        lookup_tenant_id = target_tenant_id if target_tenant_id else user.tenant_id
        purchased = _get_tenant_purchased_semantic_agent_ids(db, lookup_tenant_id)
        catalogs = _catalog_rows_for_semantic_agent_ids(db, purchased)
        return [AgentResponse.from_catalog(c, lookup_tenant_id) for c in catalogs]
    # 一般：業務 agent_id 的交集（user_agents ∩ tenant_agents）
    allowed_ids = get_agent_ids_for_user(db, user.id)
    catalogs = _catalog_rows_for_semantic_agent_ids(db, allowed_ids)
    return [AgentResponse.from_catalog(c, user.tenant_id) for c in catalogs]


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得單一 agent（需有權限）"""
    tenant_id, aid = _parse_agent_id(agent_id, current.tenant_id)
    if tenant_id != current.tenant_id:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    catalog = resolve_agent_catalog(db, aid)
    if not catalog:
        raise HTTPException(status_code=404, detail="Agent not found")
    allowed_ids = get_agent_ids_for_user(db, current.id)
    if catalog.agent_id not in allowed_ids:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    return AgentResponse.from_catalog(catalog, current.tenant_id)
