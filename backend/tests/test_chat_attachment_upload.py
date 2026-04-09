"""整合測試：chat 訊息附加檔 multipart 上傳是否寫入 DB 與磁碟（需可連 DB、遷移已含 stored_files／訊息附件）"""
from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

import app.api.endpoints.chat_threads as chat_threads_module
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_current_user
from app.main import app

from app.models.chat_message_attachment import ChatMessageAttachment
from app.models.chat_thread import ChatThread
from app.models.user import User
from app.services.chat_attachment_service import (
    cleanup_stored_file_if_unreferenced,
    collect_attachment_file_ids_for_thread,
)
from app.services.stored_files_store import get_stored_files_base_dir


def _fresh_user(uid: int) -> User:
    db = SessionLocal()
    try:
        u = db.get(User, uid)
        assert u is not None
        db.expunge(u)
        return u
    finally:
        db.close()


@pytest.fixture
def setup(monkeypatch):
    db = SessionLocal()
    try:
        user = db.query(User).first()
        if user is None:
            pytest.skip("資料庫無 users，無法測試")
        uid = user.id
    finally:
        db.close()

    tmp_root = Path(tempfile.mkdtemp(prefix="stored_files_test_"))
    monkeypatch.setattr(settings, "STORED_FILES_DIR", str(tmp_root))

    fake_agent = f"test-chat-{uuid.uuid4().hex[:8]}"

    def fake_check_agent_access(db, current_user, agent_id):
        return current_user.tenant_id, fake_agent

    monkeypatch.setattr(chat_threads_module, "_check_agent_access", fake_check_agent_access)

    def override_current():
        return _fresh_user(uid)

    app.dependency_overrides[get_current_user] = override_current
    client = TestClient(app)
    yield client, fake_agent, tmp_root
    app.dependency_overrides.clear()
    shutil.rmtree(tmp_root, ignore_errors=True)


def test_upload_attachment_creates_db_row_and_blob(setup):
    client, agent_id, tmp_root = setup

    r = client.post("/api/v1/chat/threads", json={"agent_id": agent_id, "title": "pytest upload"})
    assert r.status_code == 201, r.text
    thread_id = r.json()["id"]

    r2 = client.post(
        f"/api/v1/chat/threads/{thread_id}/messages",
        json={"role": "user", "content": "hello with file"},
    )
    assert r2.status_code == 201, r2.text
    message_id = r2.json()["id"]

    files = [("files", ("note.txt", b"line1\nline2\n", "text/plain"))]
    r3 = client.post(
        f"/api/v1/chat/threads/{thread_id}/messages/{message_id}/attachments",
        files=files,
    )
    assert r3.status_code == 201, r3.text
    assert r3.json().get("uploaded") == 1

    r4 = client.get(f"/api/v1/chat/threads/{thread_id}/messages")
    assert r4.status_code == 200
    rows = r4.json()
    user_msgs = [m for m in rows if m["role"] == "user" and m["id"] == message_id]
    assert len(user_msgs) == 1
    assert len(user_msgs[0].get("attachments") or []) == 1
    assert user_msgs[0]["attachments"][0]["original_filename"] == "note.txt"

    db = SessionLocal()
    try:
        n = db.query(ChatMessageAttachment).filter(ChatMessageAttachment.message_id == message_id).count()
        assert n == 1
    finally:
        db.close()

    base = get_stored_files_base_dir()
    assert base is not None
    assert base.resolve() == tmp_root.resolve()
    blobs = list(tmp_root.rglob("blob"))
    assert len(blobs) >= 1
    assert blobs[0].read_text(encoding="utf-8") == "line1\nline2\n"

    # 勿在開發用 DB 留下指向「已刪暫存目錄」的 stored_files 列（否則會以為上傳成功但磁碟無檔）
    tid = UUID(str(thread_id))
    db = SessionLocal()
    try:
        fids = collect_attachment_file_ids_for_thread(db, tid)
        row = db.get(ChatThread, tid)
        if row is not None:
            db.delete(row)
            db.commit()
        for fid in fids:
            cleanup_stored_file_if_unreferenced(db, fid)
    finally:
        db.close()
