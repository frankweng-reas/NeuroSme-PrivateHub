"""整合測試：網頁 → MD API（preview + to-markdown SSE）"""
from __future__ import annotations

import json

import httpx
import pytest

from app.core.database import SessionLocal
from app.core.security import get_current_user
from app.main import app
from app.models.user import User
from app.services.web_to_md_service import _fetch_web_preview_sync

CHAGE_URL = "https://www.chage.com.tw/index.php?lang=tw"
API = "/api/v1"

CHAGE_LIKE_HTML = """
<div class="panel">
  <p>熟，當人們與好事、好物聚集後自然而成的黃金比例</p>
  <h1>熱銷產品</h1><h2>Hot products</h2>
  <h3>香片姍姍</h3>
  <p>2021榮獲iTi比利時風味絕佳獎二星等級殊榮，香氣四溢，天然回甘。</p>
  <h3>膠原戀檸C</h3>
  <p>無咖啡因，嚴選屏東檸檬特調</p>
</div>
<div class="panel">
  <h1>最新消息</h1>
  <h3>香片領導品牌—蘋安紅</h3>
  <li>2026-01-01</li>
</div>
"""


def _fresh_user(uid: int) -> User:
    db = SessionLocal()
    try:
        u = db.get(User, uid)
        assert u is not None
        db.expunge(u)
        return u
    finally:
        db.close()


def _parse_sse_events(raw: str) -> list[dict]:
    events: list[dict] = []
    for block in raw.split("\n\n"):
        block = block.strip()
        if not block.startswith("data: "):
            continue
        events.append(json.loads(block[6:]))
    return events


@pytest.fixture
async def authed_client():
    db = SessionLocal()
    try:
        user = db.query(User).first()
        if user is None:
            pytest.skip("資料庫無 users，無法測試")
        uid = user.id
    finally:
        db.close()

    def override_current():
        return _fresh_user(uid)

    app.dependency_overrides[get_current_user] = override_current
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_web_to_markdown_sse_completes_with_fixture_html(authed_client: httpx.AsyncClient):
    """確認 SSE 事件序列完整（曾漏 _sse 包裝會導致前端卡住）。"""
    res = await authed_client.post(
        f"{API}/doc-refiner/web/to-markdown",
        data={
            "source_url": CHAGE_URL,
            "title": "茶聚",
            "content_html": CHAGE_LIKE_HTML,
        },
    )
    assert res.status_code == 200, res.text
    assert "text/event-stream" in res.headers.get("content-type", "")

    events = _parse_sse_events(res.text)
    types = [e.get("type") for e in events]
    assert types[0] == "extract_progress"
    assert "meta" in types
    assert "md_chunk" in types
    assert types[-1] == "done"

    md_chunks = [e["content"] for e in events if e.get("type") == "md_chunk"]
    assert len(md_chunks) == 1
    md = md_chunks[0]
    assert "source: doc-refiner-web-md" in md
    assert "iTi" in md
    assert "膠原戀檸C" in md
    assert "蘋安紅" in md


@pytest.mark.anyio
async def test_web_preview_and_to_markdown_e2e_chage(authed_client: httpx.AsyncClient):
    """端到端：真實抓取茶聚官網 → 預覽 → 結構化（需外網）。"""
    preview_res = await authed_client.post(
        f"{API}/doc-refiner/web/preview",
        json={"url": CHAGE_URL},
        timeout=60.0,
    )
    assert preview_res.status_code == 200, preview_res.text
    preview = preview_res.json()
    assert preview["text_length"] > 400
    assert "熱銷" in preview["content_html"]

    md_res = await authed_client.post(
        f"{API}/doc-refiner/web/to-markdown",
        data={
            "source_url": preview["source_url"],
            "title": preview["title"],
            "content_html": preview["content_html"],
        },
        timeout=60.0,
    )
    assert md_res.status_code == 200, md_res.text
    events = _parse_sse_events(md_res.text)
    assert events[-1]["type"] == "done"

    md = next(e["content"] for e in events if e["type"] == "md_chunk")
    for kw in ("iTi", "膠原戀檸C", "沐嵐鮮奶紅", "半熟奶茶", "蘋安紅", "香氣四溢"):
        assert kw in md, f"missing {kw}"


def test_service_preview_matches_api_expectations():
    """服務層抽測：確保 fallback 正文足夠長。"""
    preview = _fetch_web_preview_sync(CHAGE_URL)
    assert preview.text_length > 400
    assert "香片姍姍" in preview.content_html
