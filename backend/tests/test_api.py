"""API 測試：驗證 users、agents、user_agents 相關功能（需 JWT 認證）"""
import pytest
import jwt
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)
API = "/api/v1"


def _auth_headers(email: str = "test01@test.com") -> dict:
    """產生 test01 的 JWT（與 LocalAuth 格式相容）"""
    token = jwt.encode(
        {"sub": "test-uuid", "email": email},
        settings.JWT_SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def test_health():
    """Health check 不需認證"""
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_get_user_by_email():
    """取得 test01 使用者（需登入）"""
    r = client.get(
        f"{API}/users/by-email?email=test01@test.com",
        headers=_auth_headers(),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "test01@test.com"
    assert "id" in data


def test_get_me():
    """取得當前使用者"""
    r = client.get(f"{API}/users/me", headers=_auth_headers())
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "test01@test.com"
    assert "id" in data


def test_list_users():
    """列出所有使用者（需 admin）"""
    r = client.get(f"{API}/users/", headers=_auth_headers())
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_list_agents():
    """取得當前使用者的 agents"""
    r = client.get(f"{API}/agents/", headers=_auth_headers())
    assert r.status_code == 200
    agents = r.json()
    assert isinstance(agents, list)


def test_get_user_agents():
    """取得 test01 的 agent 權限"""
    r = client.get(f"{API}/users/me", headers=_auth_headers())
    assert r.status_code == 200
    user_id = r.json()["id"]

    r = client.get(f"{API}/users/{user_id}/agents", headers=_auth_headers())
    assert r.status_code == 200
    data = r.json()
    assert "agent_ids" in data
    assert isinstance(data["agent_ids"], list)


def test_agents_for_user():
    """test01 登入後應能取得有權限的 agents"""
    r = client.get(f"{API}/agents/", headers=_auth_headers())
    assert r.status_code == 200
    agents = r.json()
    assert isinstance(agents, list)


def test_update_user_agents_roundtrip():
    """更新 user agents 並驗證（需 admin）"""
    r = client.get(f"{API}/users/me", headers=_auth_headers())
    assert r.status_code == 200
    user_data = r.json()
    user_id = user_data["id"]

    r = client.get(f"{API}/users/{user_id}/agents", headers=_auth_headers())
    assert r.status_code == 200
    original_ids = r.json()["agent_ids"]

    r = client.get(f"{API}/agents/", headers=_auth_headers())
    assert r.status_code == 200
    all_agents = r.json()
    if not all_agents:
        pytest.skip("No agents in DB")
    all_ids = [a["id"] for a in all_agents]

    new_ids = all_ids[:1] if all_ids else []
    r = client.put(
        f"{API}/users/{user_id}/agents",
        json={"agent_ids": new_ids},
        headers=_auth_headers(),
    )
    if r.status_code == 403:
        pytest.skip("test01 非 admin，無法更新 agents")
    assert r.status_code == 200

    r = client.get(f"{API}/users/{user_id}/agents", headers=_auth_headers())
    assert r.json()["agent_ids"] == new_ids

    client.put(
        f"{API}/users/{user_id}/agents",
        json={"agent_ids": original_ids},
        headers=_auth_headers(),
    )


def test_unauthorized():
    """未提供 token 應回 401"""
    r = client.get(f"{API}/users/me")
    assert r.status_code == 401
