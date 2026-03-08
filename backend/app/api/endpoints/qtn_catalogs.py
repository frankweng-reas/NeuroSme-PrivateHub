"""QtnCatalogs API：公司產品/服務報價清單"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.qtn_catalog import QtnCatalog
from app.models.user import User
from app.schemas.qtn_catalog import QtnCatalogCreate, QtnCatalogResponse

router = APIRouter()


@router.post("/", response_model=QtnCatalogResponse)
def create_qtn_catalog(
    body: QtnCatalogCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """新增報價清單（公司層級）"""
    if body.is_default:
        db.query(QtnCatalog).filter(
            QtnCatalog.tenant_id == current.tenant_id,
            QtnCatalog.is_default.is_(True),
        ).update({"is_default": False})

    cat = QtnCatalog(
        tenant_id=current.tenant_id,
        catalog_name=body.catalog_name.strip(),
        content=body.content,
        is_default=body.is_default,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return QtnCatalogResponse(
        catalog_id=str(cat.catalog_id),
        tenant_id=cat.tenant_id,
        catalog_name=cat.catalog_name,
        content=cat.content,
        is_default=cat.is_default,
        created_at=cat.created_at,
    )


@router.get("/", response_model=list[QtnCatalogResponse])
def list_qtn_catalogs(
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得該公司的報價清單列表"""
    catalogs = (
        db.query(QtnCatalog)
        .filter(QtnCatalog.tenant_id == current.tenant_id)
        .order_by(QtnCatalog.is_default.desc(), QtnCatalog.created_at.desc())
        .all()
    )
    return [
        QtnCatalogResponse(
            catalog_id=str(c.catalog_id),
            tenant_id=c.tenant_id,
            catalog_name=c.catalog_name,
            content=c.content,
            is_default=c.is_default,
            created_at=c.created_at,
        )
        for c in catalogs
    ]


@router.delete("/{catalog_id}")
def delete_qtn_catalog(
    catalog_id: UUID,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除報價清單（僅能刪除本公司）"""
    cat = db.query(QtnCatalog).filter(
        QtnCatalog.catalog_id == catalog_id,
        QtnCatalog.tenant_id == current.tenant_id,
    ).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Catalog not found")
    db.delete(cat)
    db.commit()
    return {"ok": True}
