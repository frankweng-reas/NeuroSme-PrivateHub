"""Writing Agent API：文件 CRUD"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.writing_document import WritingDocument

router = APIRouter()

CONTENT_MAX_CHARS = 10_000
PROMPT_MAX_CHARS = 2_000


# ── Schemas ───────────────────────────────────────────────────────────────────

class WritingDocCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str | None = Field(default=None, max_length=CONTENT_MAX_CHARS)
    user_prompt: str | None = Field(default=None, max_length=PROMPT_MAX_CHARS)


class WritingDocUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, max_length=CONTENT_MAX_CHARS)
    user_prompt: str | None = Field(default=None, max_length=PROMPT_MAX_CHARS)
    draft: str | None = None


class WritingDocResponse(BaseModel):
    id: int
    title: str
    content: str | None
    user_prompt: str | None
    draft: str | None
    created_at: str
    updated_at: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_tenant_id(current: User) -> str:
    tid = (current.tenant_id or "").strip()
    if not tid:
        raise HTTPException(status_code=403, detail="使用者未綁定租戶")
    return tid


def _to_resp(doc: WritingDocument) -> WritingDocResponse:
    return WritingDocResponse(
        id=doc.id,
        title=doc.title,
        content=doc.content,
        user_prompt=doc.user_prompt,
        draft=doc.draft,
        created_at=doc.created_at.isoformat() if doc.created_at else "",
        updated_at=doc.updated_at.isoformat() if doc.updated_at else "",
    )


def _get_doc_or_404(doc_id: int, tenant_id: str, user_id: int, db: Session) -> WritingDocument:
    doc = db.query(WritingDocument).filter(
        WritingDocument.id == doc_id,
        WritingDocument.tenant_id == tenant_id,
        WritingDocument.user_id == user_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="文件不存在")
    return doc


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[WritingDocResponse], summary="列出我的文件")
def list_docs(
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    docs = (
        db.query(WritingDocument)
        .filter(
            WritingDocument.tenant_id == tenant_id,
            WritingDocument.user_id == current.id,
        )
        .order_by(WritingDocument.updated_at.desc())
        .all()
    )
    return [_to_resp(d) for d in docs]


@router.post("", response_model=WritingDocResponse, status_code=201, summary="新增文件")
def create_doc(
    body: WritingDocCreate,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    doc = WritingDocument(
        tenant_id=tenant_id,
        user_id=current.id,
        title=body.title,
        content=body.content,
        user_prompt=body.user_prompt,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _to_resp(doc)


@router.patch("/{doc_id}", response_model=WritingDocResponse, summary="更新文件")
def update_doc(
    doc_id: int,
    body: WritingDocUpdate,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    doc = _get_doc_or_404(doc_id, tenant_id, current.id, db)
    if body.title is not None:
        doc.title = body.title
    if body.content is not None:
        doc.content = body.content
    if body.user_prompt is not None:
        doc.user_prompt = body.user_prompt
    if body.draft is not None:
        doc.draft = body.draft
    db.commit()
    db.refresh(doc)
    return _to_resp(doc)


@router.delete("/{doc_id}", status_code=204, summary="刪除文件")
def delete_doc(
    doc_id: int,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
):
    tenant_id = _get_tenant_id(current)
    doc = _get_doc_or_404(doc_id, tenant_id, current.id, db)
    db.delete(doc)
    db.commit()
