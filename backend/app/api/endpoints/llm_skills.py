"""LLM Skills API：tenant 共用 prompt 範本 CRUD（admin 維護，所有用戶可讀）"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.llm_skill import LlmSkill
from app.models.user import User

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class LlmSkillCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    prompt: str = Field(..., min_length=1)
    sort_order: int = Field(default=0)


class LlmSkillUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    prompt: str | None = Field(default=None, min_length=1)
    sort_order: int | None = None


class LlmSkillResponse(BaseModel):
    id: int
    title: str
    category: str | None
    description: str | None
    prompt: str
    sort_order: int
    created_at: str
    updated_at: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_tenant_id(current: User) -> str:
    tid = (current.tenant_id or "").strip()
    if not tid:
        raise HTTPException(status_code=403, detail="使用者未綁定租戶")
    return tid


def _require_admin(current: User) -> None:
    if current.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="需要管理員權限")


def _to_resp(skill: LlmSkill) -> LlmSkillResponse:
    return LlmSkillResponse(
        id=skill.id,
        title=skill.title,
        category=skill.category,
        description=skill.description,
        prompt=skill.prompt,
        sort_order=skill.sort_order,
        created_at=skill.created_at.isoformat() if skill.created_at else "",
        updated_at=skill.updated_at.isoformat() if skill.updated_at else "",
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[LlmSkillResponse])
def list_skills(
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """列出目前 tenant 的所有 skills（所有用戶可讀）"""
    tenant_id = _get_tenant_id(current)
    skills = (
        db.query(LlmSkill)
        .filter(LlmSkill.tenant_id == tenant_id)
        .order_by(LlmSkill.sort_order, LlmSkill.id)
        .all()
    )
    return [_to_resp(s) for s in skills]


@router.post("", response_model=LlmSkillResponse, status_code=201)
def create_skill(
    body: LlmSkillCreate,
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """新增 skill（admin only）"""
    _require_admin(current)
    tenant_id = _get_tenant_id(current)
    skill = LlmSkill(
        tenant_id=tenant_id,
        created_by=current.id,
        title=body.title,
        category=body.category,
        description=body.description,
        prompt=body.prompt,
        sort_order=body.sort_order,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return _to_resp(skill)


@router.put("/{skill_id}", response_model=LlmSkillResponse)
def update_skill(
    skill_id: int,
    body: LlmSkillUpdate,
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """更新 skill（admin only）"""
    _require_admin(current)
    tenant_id = _get_tenant_id(current)
    skill = db.query(LlmSkill).filter(LlmSkill.id == skill_id, LlmSkill.tenant_id == tenant_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    if body.title is not None:
        skill.title = body.title
    if body.category is not None:
        skill.category = body.category
    if body.description is not None:
        skill.description = body.description
    if body.prompt is not None:
        skill.prompt = body.prompt
    if body.sort_order is not None:
        skill.sort_order = body.sort_order
    db.commit()
    db.refresh(skill)
    return _to_resp(skill)


@router.delete("/{skill_id}", status_code=204)
def delete_skill(
    skill_id: int,
    current: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """刪除 skill（admin only）"""
    _require_admin(current)
    tenant_id = _get_tenant_id(current)
    skill = db.query(LlmSkill).filter(LlmSkill.id == skill_id, LlmSkill.tenant_id == tenant_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    db.delete(skill)
    db.commit()
