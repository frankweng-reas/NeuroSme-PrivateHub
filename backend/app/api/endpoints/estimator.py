"""Estimator API：試算情境範本 CRUD

端點（prefix: /estimator）：
  GET    /templates          — 列出目前用戶的情境範本
  POST   /templates          — 建立情境範本
  PUT    /templates/{id}     — 更新情境範本
  DELETE /templates/{id}     — 刪除情境範本
"""
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.estimator_template import EstimatorTemplate
from app.models.user import User

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class EstimatorFieldSchema(BaseModel):
    key: str
    label: str
    unit: str = ""
    type: str = "number"  # number | percent | currency


class EstimatorOutputSchema(BaseModel):
    key: str
    label: str
    formula: str


class EstimatorSchemaBody(BaseModel):
    fields: list[EstimatorFieldSchema] = []
    outputs: list[EstimatorOutputSchema] = []


class TemplateCreateRequest(BaseModel):
    name: str
    schema_data: EstimatorSchemaBody


class TemplateUpdateRequest(BaseModel):
    name: str | None = None
    schema_data: EstimatorSchemaBody | None = None


class TemplateResponse(BaseModel):
    id: str
    name: str
    schema_data: dict[str, Any]
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


def _to_response(t: EstimatorTemplate) -> TemplateResponse:
    return TemplateResponse(
        id=str(t.id),
        name=t.name,
        schema_data=t.schema or {},
        created_at=t.created_at.isoformat(),
        updated_at=t.updated_at.isoformat(),
    )


def _get_own(db: Session, template_id: str, user_id: int, tenant_id: str) -> EstimatorTemplate:
    try:
        uid = uuid.UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="範本不存在")
    row = (
        db.query(EstimatorTemplate)
        .filter(
            EstimatorTemplate.id == uid,
            EstimatorTemplate.user_id == user_id,
            EstimatorTemplate.tenant_id == tenant_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="範本不存在")
    return row


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/templates", response_model=list[TemplateResponse])
def list_templates(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    rows = (
        db.query(EstimatorTemplate)
        .filter(
            EstimatorTemplate.tenant_id == current.tenant_id,
            EstimatorTemplate.user_id == current.id,
        )
        .order_by(EstimatorTemplate.updated_at.desc())
        .all()
    )
    return [_to_response(r) for r in rows]


@router.post("/templates", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
def create_template(
    body: TemplateCreateRequest,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    row = EstimatorTemplate(
        tenant_id=current.tenant_id,
        user_id=current.id,
        name=body.name.strip() or "未命名",
        schema=body.schema_data.model_dump(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.put("/templates/{template_id}", response_model=TemplateResponse)
def update_template(
    template_id: str,
    body: TemplateUpdateRequest,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    row = _get_own(db, template_id, current.id, current.tenant_id)
    if body.name is not None:
        row.name = body.name.strip() or row.name
    if body.schema_data is not None:
        row.schema = body.schema_data.model_dump()
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: str,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    row = _get_own(db, template_id, current.id, current.tenant_id)
    db.delete(row)
    db.commit()
