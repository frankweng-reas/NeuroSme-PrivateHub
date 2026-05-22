# NeuroSme Public API 整合指南

本文說明如何透過 NeuroSme Public API 將 AI 客服 Bot 整合至外部系統，例如 Facebook Messenger、LINE、自訂 App 等。

---

## 前置準備

1. 登入 NeuroSme 管理後台
2. 進入「KB Bot 助理」→ 選擇目標 Bot → 「API 整合」tab
3. 建立一組 API Key（例如備註填「LINE」或「FB Messenger」）
4. 複製 API Key（`nsk_xxxx...`），**只顯示一次，請立即保存**

---

## API 規格

### 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/v1/public/bot/content` | 取得熱門/常見 FAQ、聯絡資訊、首頁設定（與 Widget 一致） |
| POST | `/api/v1/public/bot/query` | 知識庫問答（RAG） |

例如：`https://ee.neurosme.ai:4443/api/v1/public/bot/query`

### 認證

```
X-API-Key: nsk_your_key_here
```

### Request Body

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `question` | string | ✅ | 本輪使用者的問題 |
| `messages` | array | — | 之前幾輪的對話歷史（多輪對話記憶用） |
| `external_user_id` | string | — | 外部平台的使用者 ID（如 FB PSID、LINE UID）。與 `external_platform` 同時提供才會記錄。 |
| `external_platform` | string | — | 來源平台，例如 `fb` / `line` / `custom`。 |
| `external_display_name` | string | — | 使用者顯示名稱（如 FB 的 first_name + last_name）。選填。 |

> **說明**：`external_user_id` + `external_platform` + `external_display_name` 三個欄位皆為選填，不填不影響問答功能。填寫後，NeuroSme 會自動建立或更新外部使用者記錄，供後台追蹤各渠道的使用者對話行為。

`messages` 格式：
```json
[
  { "role": "user",      "content": "上一輪使用者說的話" },
  { "role": "assistant", "content": "上一輪 Bot 的回答" }
]
```

### Response Body

| 欄位 | 類型 | 說明 |
|------|------|------|
| `answer` | string | AI 回答內容 |
| `sources` | array | 引用的知識庫段落（filename + excerpt） |

---

## 取得展示內容（GET /content）

用於 LINE / Messenger 等渠道建立「熱門問題」按鈕或 FAQ 選單，無需呼叫 LLM。

```bash
curl "https://your-domain/api/v1/public/bot/content" \
  -H "X-API-Key: nsk_your_key_here"
```

回傳欄位（節錄）：

| 欄位 | 說明 |
|------|------|
| `popular_faq_enabled` | 是否啟用熱門 FAQ |
| `popular_faqs` | `[{ id, question, answer }]` |
| `common_faq_enabled` | 是否啟用常見 FAQ |
| `common_faqs` | `[{ id, question, answer }]` |
| `contact_links` | 聯絡方式清單 |
| `home_greeting` | 首頁歡迎語 |

僅回傳已啟用區塊的內容；Rate limit：1000 次/小時。

---

## 範例：curl（問答）

```bash
curl -X POST https://your-domain/api/v1/public/bot/query \
  -H "X-API-Key: nsk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "那運費怎麼算？",
    "messages": [
      {
        "role": "user",
        "content": "請問可以退貨嗎？"
      },
      {
        "role": "assistant",
        "content": "可以，商品到貨 7 天內可申請退貨，請保持商品原狀並附上發票。"
      }
    ]
  }'
```

---

## 範例：Facebook Messenger Webhook（Python）

以下為完整的 FB Messenger connector 範例，包含熱門問題（Quick Replies）與常見問題（Generic Template）。  
**Connector 由客戶自行部署，NeuroSme 不需要任何修改。**

### FB Messenger 元件對應

| Widget 功能 | FB Messenger 元件 | 說明 |
|------------|-------------------|------|
| 熱門問題 | **Quick Replies** | 訊息下方可點擊的按鈕列，最多 13 個，標題限 20 字 |
| 常見問題 | **Generic Template** | 卡片式清單，每張卡有標題、摘要、按鈕，最多 10 張 |
| AI 問答 | **文字訊息** | 呼叫 RAG API，回傳純文字 |

### 完整程式碼

```python
# requirements: fastapi uvicorn httpx
# 儲存為 fb_connector.py
from fastapi import FastAPI, Request
import httpx, os

app = FastAPI()

VERIFY_TOKEN      = os.environ["VERIFY_TOKEN"]
PAGE_ACCESS_TOKEN = os.environ["PAGE_ACCESS_TOKEN"]
NEUROSME_BASE_URL = os.environ["NEUROSME_BASE_URL"]  # https://your-domain
NEUROSME_API_KEY  = os.environ["NEUROSME_API_KEY"]   # nsk_xxxx

# FB 使用者資料快取：{ psid: { "display_name": "Frank W" } }
_fb_user_cache: dict[str, dict] = {}

FB_API = "https://graph.facebook.com/v19.0/me/messages"

# 對話歷史暫存（生產環境請換成 Redis 或資料庫）
_history: dict[str, list] = {}

# Bot 內容快取（熱門/常見 FAQ），啟動後快取，避免重複呼叫
_bot_content: dict | None = None


# ── 工具函式 ──────────────────────────────────────────────────────────────────

async def get_bot_content() -> dict:
    """取得並快取 Bot 的 FAQ 內容（熱門問題 / 常見問題）。"""
    global _bot_content
    if _bot_content is None:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{NEUROSME_BASE_URL}/api/v1/public/bot/content",
                headers={"X-API-Key": NEUROSME_API_KEY},
            )
            _bot_content = r.json()
    return _bot_content


async def get_fb_display_name(psid: str) -> str | None:
    """取得 FB 使用者顯示名稱（第一次才呼叫 Graph API，之後快取）。"""
    if psid in _fb_user_cache:
        return _fb_user_cache[psid].get("display_name")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"https://graph.facebook.com/v19.0/{psid}",
                params={"fields": "first_name,last_name", "access_token": PAGE_ACCESS_TOKEN},
            )
            data = r.json()
            display_name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()
            _fb_user_cache[psid] = {"display_name": display_name}
            return display_name
    except Exception:
        return None


async def send_fb(sender_id: str, message: dict) -> None:
    """送出任意訊息物件給指定的 Messenger 使用者。"""
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(
            FB_API,
            params={"access_token": PAGE_ACCESS_TOKEN},
            json={"recipient": {"id": sender_id}, "message": message},
        )


async def send_text(sender_id: str, text: str) -> None:
    """送出純文字訊息（超過 2000 字自動截斷）。"""
    await send_fb(sender_id, {"text": text[:2000]})


async def send_popular_faqs(sender_id: str, faqs: list, greeting: str) -> None:
    """以 Quick Replies 顯示熱門問題（最多 13 個，標題限 20 字）。"""
    quick_replies = [
        {
            "content_type": "text",
            "title": faq["question"][:20],
            "payload": f"FAQ_{faq['id']}",
        }
        for faq in faqs[:13]
    ]
    await send_fb(sender_id, {
        "text": greeting or "您好！請問有什麼可以協助您的？",
        "quick_replies": quick_replies,
    })


async def send_common_faqs(sender_id: str, faqs: list) -> None:
    """以 Generic Template（卡片）顯示常見問題（最多 10 張）。"""
    elements = [
        {
            "title": faq["question"][:80],
            "subtitle": faq["answer"][:80] + ("..." if len(faq["answer"]) > 80 else ""),
            "buttons": [{
                "type": "postback",
                "title": "查看完整回答",
                "payload": f"FAQ_{faq['id']}",
            }],
        }
        for faq in faqs[:10]
    ]
    await send_fb(sender_id, {
        "attachment": {
            "type": "template",
            "payload": {
                "template_type": "generic",
                "elements": elements,
            },
        }
    })


async def query_neurosme(
    question: str,
    history: list,
    external_user_id: str | None = None,
    external_display_name: str | None = None,
) -> str:
    """呼叫 NeuroSme RAG API 取得 AI 回答。
    
    傳入 external_user_id 後，NeuroSme 會自動建立/更新外部使用者記錄，
    讓後台可以追蹤各 FB 使用者的對話行為。
    """
    payload: dict = {"question": question, "messages": history}
    if external_user_id:
        payload["external_user_id"] = external_user_id
        payload["external_platform"] = "fb"
        if external_display_name:
            payload["external_display_name"] = external_display_name
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{NEUROSME_BASE_URL}/api/v1/public/bot/query",
            headers={"X-API-Key": NEUROSME_API_KEY},
            json=payload,
        )
        return r.json()["answer"]


# ── Webhook 端點 ──────────────────────────────────────────────────────────────

@app.get("/webhook")
def verify(hub_mode: str, hub_verify_token: str, hub_challenge: str):
    if hub_verify_token == VERIFY_TOKEN:
        return int(hub_challenge)
    return {"error": "invalid token"}, 403


@app.post("/webhook")
async def receive(req: Request):
    body = await req.json()
    content = await get_bot_content()

    for entry in body.get("entry", []):
        for event in entry.get("messaging", []):
            sender = event["sender"]["id"]

            # ── Postback：使用者點擊了 FAQ 按鈕 ──────────────────────────────
            postback_payload = event.get("postback", {}).get("payload", "")
            if postback_payload.startswith("FAQ_"):
                faq_id = int(postback_payload.split("_")[1])
                all_faqs = content.get("popular_faqs", []) + content.get("common_faqs", [])
                faq = next((f for f in all_faqs if f["id"] == faq_id), None)
                if faq:
                    await send_text(sender, faq["answer"])
                continue

            # ── 文字訊息 ──────────────────────────────────────────────────────
            text = event.get("message", {}).get("text", "").strip()
            if not text:
                continue

            # 打招呼 → 顯示熱門問題（Quick Replies）
            GREETINGS = {"你好", "hi", "hello", "哈囉", "開始", "嗨", "hey"}
            if text.lower() in GREETINGS and content.get("popular_faq_enabled"):
                greeting = content.get("home_greeting", "")
                await send_popular_faqs(sender, content["popular_faqs"], greeting)
                continue

            # 輸入「常見問題」→ 顯示 Generic Template 卡片
            if text == "常見問題" and content.get("common_faq_enabled"):
                await send_common_faqs(sender, content["common_faqs"])
                continue

            # 其他輸入 → 呼叫 NeuroSme RAG 問答
            history = _history.get(sender, [])
            display_name = await get_fb_display_name(sender)
            answer = await query_neurosme(text, history, sender, display_name)
            _history[sender] = (history + [
                {"role": "user",      "content": text},
                {"role": "assistant", "content": answer},
            ])[-20:]  # 保留最近 10 輪
            await send_text(sender, answer)

    return {"status": "ok"}
```

### 啟動方式

```bash
VERIFY_TOKEN=my_secret \
PAGE_ACCESS_TOKEN=EAAxxxxx \
NEUROSME_BASE_URL=https://your-domain \
NEUROSME_API_KEY=nsk_your_key_here \
uvicorn fb_connector:app --host 0.0.0.0 --port 8080
```

FB Developer Console Webhook URL 填：`https://你的connector網址/webhook`

### 互動流程說明

```
使用者輸入「你好」
  → Connector 呼叫 GET /content 取得熱門問題
  → 回傳訊息 + Quick Replies 按鈕列（最多 13 個問題）

使用者點擊某個熱門問題按鈕
  → Postback payload = "FAQ_{id}"
  → Connector 從快取找到 answer，直接回傳（不呼叫 LLM，速度快）

使用者輸入「常見問題」
  → 回傳 Generic Template 卡片清單（最多 10 張）
  → 每張卡有摘要預覽 + 「查看完整回答」按鈕

使用者輸入任意問題
  → 呼叫 POST /query（RAG），帶入對話歷史，回傳 AI 回答
```

---

## 注意事項

- **Rate Limit**：每個 API Key 每小時最多 **100 次**請求。流量大請建立多把 Key 或聯繫 REAS 調整。
- **對話記憶**：NeuroSme API 本身不儲存對話歷史，**由 Connector 負責維護並每次帶入 `messages`**。
- **CORS**：Connector 是後端呼叫後端，不受 CORS 限制，不需修改 NeuroSme 設定。
- **完整 API 規格**：`https://your-domain/api/v1/public/docs`（Swagger UI）

---

## 外部使用者追蹤說明

當 connector 在 `/query` 請求帶入 `external_user_id` + `external_platform` 時，NeuroSme 會自動：

1. 若該使用者是第一次出現 → 在後台建立外部使用者記錄
2. 若已存在 → 更新 `display_name`（若有提供）與 `last_seen_at`
3. 將本次查詢的 log 與該使用者關聯

後台即可查詢「哪個 FB 用戶問了哪些問題、命中率如何」。

`external_platform` 建議值：

| 值 | 適用情境 |
|----|---------|
| `fb` | Facebook Messenger |
| `line` | LINE Messaging API |
| `custom` | 自訂 App 或其他渠道 |

---

*最後更新：2026-05-22*
