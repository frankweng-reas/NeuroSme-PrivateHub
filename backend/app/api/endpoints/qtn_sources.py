"""QtnSources API：專案來源檔案（產品/服務清單、需求描述）"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.qtn_project import QtnProject
from app.models.qtn_source import QtnSource
from app.models.user import User
from app.schemas.qtn_source import QtnSourceCreate, QtnSourceResponse, QtnSourceUpdate

router = APIRouter()


def _check_project_access(db: Session, user: User, project_id: str) -> QtnProject:
    """驗證專案屬於該使用者"""
    try:
        pid = UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id 格式錯誤")
    proj = db.query(QtnProject).filter(QtnProject.project_id == pid).first()
    if not proj:
        raise HTTPException(status_code=404, detail="專案不存在")
    if proj.user_id != str(user.id):
        raise HTTPException(status_code=403, detail="無權限存取此專案")
    return proj


@router.post("/", response_model=QtnSourceResponse)
def create_qtn_source(
    body: QtnSourceCreate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """新增專案來源（產品/服務清單或需求描述）"""
    _check_project_access(db, current, body.project_id)

    if body.source_type not in ("OFFERING", "REQUIREMENT"):
        raise HTTPException(status_code=400, detail="source_type 須為 OFFERING 或 REQUIREMENT")

    src = QtnSource(
        project_id=UUID(body.project_id),
        source_type=body.source_type,
        file_name=body.file_name.strip(),
        content=body.content,
    )
    db.add(src)
    db.commit()
    db.refresh(src)
    return QtnSourceResponse(
        source_id=str(src.source_id),
        project_id=str(src.project_id),
        source_type=src.source_type,
        file_name=src.file_name,
        content=src.content,
        created_at=src.created_at,
    )


@router.get("/", response_model=list[QtnSourceResponse])
def list_qtn_sources(
    project_id: str = Query(..., description="專案 UUID"),
    source_type: str | None = Query(None, description="篩選 OFFERING | REQUIREMENT"),
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """取得專案的來源列表"""
    _check_project_access(db, current, project_id)

    q = db.query(QtnSource).filter(QtnSource.project_id == UUID(project_id))
    if source_type:
        if source_type not in ("OFFERING", "REQUIREMENT"):
            raise HTTPException(status_code=400, detail="source_type 須為 OFFERING 或 REQUIREMENT")
        q = q.filter(QtnSource.source_type == source_type)
    sources = q.order_by(QtnSource.created_at).all()

    return [
        QtnSourceResponse(
            source_id=str(s.source_id),
            project_id=str(s.project_id),
            source_type=s.source_type,
            file_name=s.file_name,
            content=s.content,
            created_at=s.created_at,
        )
        for s in sources
    ]


@router.patch("/{source_id}", response_model=QtnSourceResponse)
def update_qtn_source(
    source_id: str,
    body: QtnSourceUpdate,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """更新專案來源（檔名、內容）"""
    try:
        sid = UUID(source_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="source_id 格式錯誤")

    src = db.query(QtnSource).filter(QtnSource.source_id == sid).first()
    if not src:
        raise HTTPException(status_code=404, detail="來源不存在")
    _check_project_access(db, current, str(src.project_id))

    if body.file_name is not None:
        name = body.file_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="檔名不可為空")
        if name != src.file_name:
            existing = (
                db.query(QtnSource)
                .filter(
                    QtnSource.project_id == src.project_id,
                    QtnSource.source_type == src.source_type,
                    QtnSource.file_name == name,
                )
                .first()
            )
            if existing:
                raise HTTPException(status_code=400, detail="檔名重複")
            src.file_name = name

    if body.content is not None:
        src.content = body.content

    db.commit()
    db.refresh(src)
    return QtnSourceResponse(
        source_id=str(src.source_id),
        project_id=str(src.project_id),
        source_type=src.source_type,
        file_name=src.file_name,
        content=src.content,
        created_at=src.created_at,
    )


@router.delete("/{source_id}")
def delete_qtn_source(
    source_id: str,
    db: Session = Depends(get_db),
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """刪除專案來源"""
    try:
        sid = UUID(source_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="source_id 格式錯誤")

    src = db.query(QtnSource).filter(QtnSource.source_id == sid).first()
    if not src:
        raise HTTPException(status_code=404, detail="來源不存在")
    _check_project_access(db, current, str(src.project_id))

    db.delete(src)
    db.commit()
    return None
