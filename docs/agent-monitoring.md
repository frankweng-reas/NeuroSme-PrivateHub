# Agent 對話紀錄與 Monitoring 說明

本文件說明各 Agent 如何將對話與 LLM 呼叫紀錄下來，供 Admin ChatInsights 頁面進行用量監控。

---

## 資料儲存架構

每次 LLM 呼叫的 monitoring 資訊（model、token 用量、latency、成功/失敗）寫入 `chat_llm_requests` 資料表。

觸發條件：前端呼叫 `POST /api/v1/chat/completions-stream` 時，request body 必須帶有非空的 `chat_thread_id`。若 `chat_thread_id` 為空字串或未傳，後端**不會**寫入 `chat_llm_requests`，該次呼叫在 Admin 端完全不可見。

對話內容（user / assistant 的文字）另外透過 `POST /api/v1/chat/threads/{id}/messages` 寫入 `chat_messages` 資料表。`chat_messages` 與 `chat_llm_requests` 以 `llm_request_id` 關聯，關聯後可在訊息列上看到 model 與 token 資訊（`llm_meta`）。

---

## 各 Agent 的處理方式

### Chat Agent（agent_id: chat）

這是覆蓋最完整的實作，其餘 Agent 以此為基準。

進入頁面時呼叫 `createChatThread` 建立 thread，或在切換對話串時切換 `threadId`。

每次送出訊息：
- 先呼叫 `appendChatMessage` 寫入 user 訊息
- 呼叫串流 API，帶 `chat_thread_id`、`trace_id`（`crypto.randomUUID()`）、`user_message_id`
- `onDone` 時呼叫 `appendChatMessage` 寫入 assistant 訊息，並帶上 `llm_request_id`，讓訊息列與 LLM 觀測紀錄關聯

結果：Admin 可看到完整 thread 內容、每輪的 model 與 token、`llm_meta`。

---

### KM Agent（agent_id: knowledge）

進入頁面時呼叫 `createChatThread` 建立 thread；清除對話時重新建立新 thread。

每次送出訊息：
- 先呼叫 `appendChatMessage` 寫入 user 訊息
- 呼叫串流 API，帶 `chat_thread_id: threadId ?? ''`
- `onDone` 時呼叫 `appendChatMessage` 寫入 assistant 訊息

與 Chat Agent 的差異：`appendChatMessage` 沒有帶 `llm_request_id`，因此 `chat_messages` 無法 join 到 `chat_llm_requests`，訊息列上不會有 `llm_meta`（token 等）。但 `chat_llm_requests` 本身有寫入，Admin 用量統計正常。

---

### CS Agent（agent_id: cs）

處理方式與 KM Agent 完全相同。

進入頁面與切換知識庫時各自建立 thread，每輪對話寫入 user / assistant 訊息並帶 `chat_thread_id`，但 `appendChatMessage` 沒有帶 `llm_request_id`。

---

### Writing Agent（agent_id: writing）

Writing Agent 是表單驅動的單次生成工具，沒有多輪對話概念。

進入頁面時呼叫 `createChatThread` 建立 thread。

每次「生成草稿」或「段落改寫」：
- 呼叫串流 API，帶 `chat_thread_id: threadId ?? ''`
- `prompt_type` 分別為 `writing`（生成草稿）與 `writing_rewrite`（段落改寫）

**沒有**呼叫 `appendChatMessage`，因此對話內容（表單填寫的資訊、產出的草稿）不會存進 `chat_messages`。但每次 LLM 呼叫都會寫入 `chat_llm_requests`，Admin 可看到 Writing Agent 的用量、model、token 消耗。

---

### Business Agent / Customer Agent / Quotation Agent / Scheduling Agent

目前這四個 Agent 的前端**沒有**呼叫 `createChatThread` 或 `appendChatMessage`，呼叫串流 API 時也未帶 `chat_thread_id`。

後端因此不寫入 `chat_llm_requests`，Admin ChatInsights 看不到這幾個 Agent 的任何用量紀錄。

---

## 各 Agent 覆蓋程度對照

**Chat Agent**
- LLM 用量寫入：✅
- 對話內容寫入：✅
- llm_request_id 關聯：✅

**KM Agent**
- LLM 用量寫入：✅
- 對話內容寫入：✅
- llm_request_id 關聯：❌

**CS Agent**
- LLM 用量寫入：✅
- 對話內容寫入：✅
- llm_request_id 關聯：❌

**Writing Agent**
- LLM 用量寫入：✅
- 對話內容寫入：❌（無 appendChatMessage）
- llm_request_id 關聯：❌

**Business / Customer / Quotation / Scheduling Agent**
- LLM 用量寫入：❌
- 對話內容寫入：❌
- llm_request_id 關聯：❌

---

## 已知待補項目

KM 與 CS Agent 的 `appendChatMessage` 可補上 `llm_request_id`，讓 Admin 下鑽 thread 時能看到每輪的 token 明細。

Writing Agent 若有需要，可在 `onDone` 時呼叫 `appendChatMessage` 記下產出的草稿（role: assistant），以及表單摘要（role: user）。

Business / Customer / Quotation / Scheduling 等 Agent 若要接入 monitoring，最小改動是加入 `createChatThread`（進頁面時）並在串流呼叫帶上 `chat_thread_id`。
