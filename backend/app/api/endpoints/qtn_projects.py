"""QtnProjects API：建立、列表報價專案"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.agent_catalog import AgentCatalog
from app.models.qtn_project import QtnProject
from app.models.user import User
from app.schemas.qtn_project import QtnProjectCreate, QtnProjectResponse
from app.services.permission import get_agent_ids_for_user

router = APIRouter()


def _parse_agent_id(agent_id: str, fallback_tenant_id: str) -> tuple[str, str]:
    """解析 agent_id：支援 tenant_id:id 或 僅 id"""
    if ":" in agent_id:
        tenant_id, aid = agent_id.split(":", 1)
        return tenant_id, aid
    return fallback_tenant_id, agent_id


def _check_agent_access(db: Session, user: User, agent_id: str) -> tuple[str, str]:
    """驗證使用者有權限存取該 agent"""
    tenant_id, aid = _parse_agent_id(agent_id, user.tenant_id)
    if tenant_id != user.tenant_id:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    catalog = db.query(AgentCatalog).filter(AgentCatalog.id == aid).first()
    if not catalog:
        raise HTTPException(status_code=404, detail="Agent not found")
    allowed = get_agent_ids_for_user(db, user.id)
    if catalog.id not in allowed:
        raise HTTPException(status_code=403, detail="無權限存取此助理")
    return tenant_id, aid


@router.post("/", response_model=QtnProjectResponse)
def create_qtn_project(
    body: QtnProjectCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """新增報價專案"""
    tenant_id, agent_id = _check_agent_access(db, current, body.agent_id)

    proj = QtnProject(
        tenant_id=tenant_id,
        user_id=str(current.id),
        agent_id=agent_id,
        project_name=body.project_name.strip(),
        project_desc=body.project_desc.strip() or None,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return QtnProjectResponse(
        project_id=proj.project_id,
        project_name=proj.project_name,
        project_desc=proj.project_desc,
        created_at=proj.created_at,
    )


@router.get("/", response_model=list[QtnProjectResponse])
def list_qtn_projects(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得該 agent 的報價專案列表"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    projects = (
        db.query(QtnProject)
        .filter(
            QtnProject.user_id == str(current.id),
            QtnProject.tenant_id == tenant_id,
            QtnProject.agent_id == aid,
        )
        .order_by(QtnProject.created_at.desc())
        .all()
    )
    return [
        QtnProjectResponse(
            project_id=p.project_id,
            project_name=p.project_name,
            project_desc=p.project_desc,
            created_at=p.created_at,
        )
        for p in projects
    ]
