"""JWT 驗證與 get_current_user：與 LocalAuth 共用 JWT_SECRET"""
import re
import secrets
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.tenant import Tenant
from app.models.user import User

security = HTTPBearer(auto_error=False)


def _ensure_username_unique(db: Session, base: str) -> str:
    """確保 username 唯一，若衝突則加後綴"""
    username = base[:90]  # username 欄位長度 100
    candidate = username
    n = 0
    while db.query(User).filter(User.username == candidate).first():
        n += 1
        candidate = f"{username}_{n}"
    return candidate


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """從 JWT 驗證取得當前使用者。若 NeuroSme2.0 無該 email 則首次登入同步建立。"""
    if not credentials or credentials.credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供認證",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=["HS256"],
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無效或過期的 token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    email = payload.get("email")
    if not email or not isinstance(email, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 缺少 email",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
    if user:
        return user
    # 首次登入同步：建立 NeuroSme2.0 User，歸入第一個 tenant
    tenant = db.query(Tenant).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="系統尚未設定 tenant，請先執行資料庫遷移",
        )
    base_username = re.sub(r"[^a-zA-Z0-9_-]", "_", email.split("@")[0]) or "user"
    username = _ensure_username_unique(db, base_username)
    # 密碼佔位，此 user 僅透過 LocalAuth JWT 認證
    placeholder_password = f"localauth_{secrets.token_hex(16)}"
    new_user = User(
        email=email,
        username=username,
        hashed_password=placeholder_password,
        role="member",
        tenant_id=tenant.id,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user
