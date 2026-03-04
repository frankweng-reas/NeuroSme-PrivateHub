"""Prompt Templates API：CRUD"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.prompt_template import PromptTemplate
from app.models.user import User
from app.schemas.prompt_template import (
    PromptTemplateCreate,
    PromptTemplateResponse,
    PromptTemplateUpdate,
)
from app.api.endpoints.source_files import _check_agent_access

router = APIRouter()


@router.get("/", response_model=list[PromptTemplateResponse])
def list_prompt_templates(
    agent_id: str = Query(..., description="agent 識別"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得該 agent 的範本列表"""
    tenant_id, aid = _check_agent_access(db, current, agent_id)

    templates = (
        db.query(PromptTemplate)
        .filter(
            PromptTemplate.user_id == current.id,
            PromptTemplate.tenant_id == tenant_id,
            PromptTemplate.agent_id == aid,
        )
        .order_by(PromptTemplate.updated_at.desc())
        .all()
    )
    return [
        PromptTemplateResponse(
            id=t.id,
            name=t.name,
            content=t.content,
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in templates
    ]


@router.post("/", response_model=PromptTemplateResponse)
def create_prompt_template(
    body: PromptTemplateCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """建立範本"""
    tenant_id, agent_id = _check_agent_access(db, current, body.agent_id)

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="範本名稱不可為空")

    existing = (
        db.query(PromptTemplate)
        .filter(
            PromptTemplate.user_id == current.id,
            PromptTemplate.tenant_id == tenant_id,
            PromptTemplate.agent_id == agent_id,
            PromptTemplate.name == name,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="範本名稱已存在")

    pt = PromptTemplate(
        user_id=current.id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        name=name,
        content=body.content,
    )
    db.add(pt)
    db.commit()
    db.refresh(pt)
    return PromptTemplateResponse(
        id=pt.id,
        name=pt.name,
        content=pt.content,
        created_at=pt.created_at,
        updated_at=pt.updated_at,
    )


@router.get("/{template_id}", response_model=PromptTemplateResponse)
def get_prompt_template(
    template_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得單一範本"""
    pt = (
        db.query(PromptTemplate)
        .filter(
            PromptTemplate.id == template_id,
            PromptTemplate.user_id == current.id,
        )
        .first()
    )
    if not pt:
        raise HTTPException(status_code=404, detail="範本不存在")
    return PromptTemplateResponse(
        id=pt.id,
        name=pt.name,
        content=pt.content,
        created_at=pt.created_at,
        updated_at=pt.updated_at,
    )


@router.patch("/{template_id}", response_model=PromptTemplateResponse)
def update_prompt_template(
    template_id: int,
    body: PromptTemplateUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新範本"""
    pt = (
        db.query(PromptTemplate)
        .filter(
            PromptTemplate.id == template_id,
            PromptTemplate.user_id == current.id,
        )
        .first()
    )
    if not pt:
        raise HTTPException(status_code=404, detail="範本不存在")

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="範本名稱不可為空")
        if name != pt.name:
            existing = (
                db.query(PromptTemplate)
                .filter(
                    PromptTemplate.user_id == current.id,
                    PromptTemplate.tenant_id == pt.tenant_id,
                    PromptTemplate.agent_id == pt.agent_id,
                    PromptTemplate.name == name,
                )
                .first()
            )
            if existing:
                raise HTTPException(status_code=400, detail="範本名稱已存在")
            pt.name = name

    if body.content is not None:
        pt.content = body.content

    db.commit()
    db.refresh(pt)
    return PromptTemplateResponse(
        id=pt.id,
        name=pt.name,
        content=pt.content,
        created_at=pt.created_at,
        updated_at=pt.updated_at,
    )


@router.delete("/{template_id}", status_code=204)
def delete_prompt_template(
    template_id: int,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除範本"""
    pt = (
        db.query(PromptTemplate)
        .filter(
            PromptTemplate.id == template_id,
            PromptTemplate.user_id == current.id,
        )
        .first()
    )
    if not pt:
        raise HTTPException(status_code=404, detail="範本不存在")
    db.delete(pt)
    db.commit()
    return None
