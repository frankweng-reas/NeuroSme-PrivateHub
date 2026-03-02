"""權限 service：查詢使用者可存取的 agent"""
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.user_agent import UserAgent


def get_agent_ids_for_user(db: Session, user_id: int) -> set[str]:
    """回傳該 user 可存取的 agent_id 集合。依 user_id 取得 tenant。"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return set()
    rows = db.query(UserAgent.agent_id).filter(
        UserAgent.user_id == user_id,
        UserAgent.tenant_id == user.tenant_id,
    ).all()
    return {r.agent_id for r in rows}
