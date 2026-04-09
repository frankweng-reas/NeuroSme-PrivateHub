# Chat 管理者／使用者洞察 — User Stories

對齊現有 `chat_*` 資料表，聚焦**租戶管理者**的用量與行為洞察（第一階不預設全文監看）。

**目前已實作（產品摘要見 `docs/chat-agent-features.md`「管理後台：Chat 用量洞察」）**：**Epic A（A-1～A-3）** 與 **Epic B（B-1～B-3）**；查詢區間以 **Asia/Taipei 日曆** 解讀。Epic C／D／E 仍為後續規劃。

> 註：`chat_thread_staged_files` 已於 migration 009 移除，以下僅列目前模型仍存在之表。

---

## 現有 `chat_*` 資料表（與洞察相關欄位）

| 表 | 與洞察最相關的欄位 |
|----|-------------------|
| **`chat_threads`** | `tenant_id`, `user_id`, `agent_id`, `title`, `status`, `last_message_at`, `created_at`, `extra` (JSONB) |
| **`chat_messages`** | `thread_id`, `sequence`, `role`, `content`, `llm_request_id`, `created_at` |
| **`chat_llm_requests`** | `tenant_id`, `user_id`, `thread_id`, `model`, `provider`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `latency_ms`, `started_at`, `finished_at`, `status`, `error_code`, `error_message`, `trace_id`, `extra` (JSONB) |
| **`chat_message_attachments`** | `message_id`, `file_id`, `created_at`（需 join `chat_messages` → `thread_id`；使用者可自 `chat_threads` 取） |

**寫入現況**：`chat.py` 的 `_persist_chat_llm_request` 會填入 token／latency／status／error 等；參數含 `finish_reason`，**目前未寫入 `chat_llm_requests` 欄位或 `extra`**——若需「截斷率」等洞察，可另開技術 story。

**Join 習慣**：要看「哪個 agent」耗 token → `chat_llm_requests.thread_id` → `chat_threads.agent_id`（`chat_llm_requests` 本身無 `agent_id`）。

---

## Epic A：租戶級用量與成本概覽

| ID | Story | 管理者情境 | 主要資料來源 |
|----|--------|------------|--------------|
| **A-1** | 身為**租戶管理員**，我希望在選定日期區間內看到 **總 LLM 請求數、總／平均 token（prompt／completion 可分）**，以便掌握用量與成本趨勢。 | 儀表板 KPI | `chat_llm_requests`：`total_tokens`, `prompt_tokens`, `completion_tokens`, `started_at`／`finished_at`, `tenant_id` |
| **A-2** | 身為租戶管理員，我希望看到用量 **依 `model` / `provider` 拆分** 的占比與趨勢，以便決定模型白名單或議價。 | 同上 | `chat_llm_requests.model`, `provider` |
| **A-3** | 身為租戶管理員，我希望看到 **成功 vs 失敗** 請求比例及常見 `error_code`，以便排查服務或金鑰問題。 | 運維／品質 | `status`, `error_code`, `error_message`（列表層級可截斷或聚合） |

---

## Epic B：使用者活躍度與排行

| ID | Story | 管理者情境 | 主要資料來源 |
|----|--------|------------|--------------|
| **B-1** | 身為租戶管理員，我希望看到區間內 **活躍使用者數（曾發生至少一次 `chat_llm_requests` 的 user）** 與 **人均 token**，以便評估採用深度。 | WAU／趨勢 | `chat_llm_requests.user_id`, `total_tokens` |
| **B-2** | 身為租戶管理員，我希望有 **依使用者的 token／請求數排行（Top N）**，並可下鑽到該使用者的 thread 列表，以便辨識暴量或異常。 | 行為治理 | `user_id` + aggregate；下鑽 → `chat_threads` where `user_id` |
| **B-3** | （選配隱私）身為租戶管理員，我希望可開啟 **匿名化顯示**（僅內部 id 或 hash），以便對外展示報表時降低個資風險。 | 合規 | 查詢層映射 `users` → 顯示名規則產品定義 |

---

## Epic C：對話脈絡（「聊了什麼」— 第一階不做全文監看）

| ID | Story | 管理者情境 | 主要資料來源 |
|----|--------|------------|--------------|
| **C-1** | 身為租戶管理員，我希望看到 **對話串列表**：`title`、`agent_id`、`last_message_at`、該 thread 的 **LLM 請求次數與加總 token**，以便快速理解「大家在哪些主題上花用量」。 | 不開全文也能概覽 | `chat_threads` LEFT JOIN aggregate `chat_llm_requests` ON `thread_id` |
| **C-2** | 身為租戶管理員，我希望看到 **依 `agent_id` 的使用量分布**（請求數、token），以便調整哪個 Chat Agent 最熱門。 | 產品採用 | `chat_threads.agent_id` + join `chat_llm_requests` |
| **C-3** | 身為租戶管理員，我希望看到 **使用者訊息數、平均 user `content` 長度、含附件的 user 訊息比例**，以便知道是否大量使用長文或附件（**不一定要把原文給主管看**）。 | 行為型態 | `chat_messages` (`role='user'`), `LENGTH(content)`, EXISTS `chat_message_attachments` |

進階（P2）：**主題／標籤**需批次寫入新表或 `extra`，目前 schema 無專用欄位。

---

## Epic D：效能與體驗（技術洞察）

| ID | Story | 管理者情境 | 主要資料來源 |
|----|--------|------------|--------------|
| **D-1** | 身為租戶管理員，我希望看到 **`latency_ms` 的 p50／p95**（依 model），以便發現某模型特別慢。 | SLO | `chat_llm_requests.latency_ms`, `model`, `status='success'`（或實際成功狀態值） |
| **D-2** | 身為值班人員，我希望用 **`trace_id`** 從一筆失敗請求對到日誌／追蹤系統，以便除錯。 | 關聯 | `trace_id` |

---

## Epic E：匯出與權限

| ID | Story | 管理者情境 | 主要資料來源 |
|----|--------|------------|--------------|
| **E-1** | 身為租戶管理員，我希望 **匯出 CSV**（區間、聚合維度可選），以便在試算表做二次分析。 | 報表 | 上述查詢結果，**預設不含 message `content`** |
| **E-2** | 身為平台設計者，我希望 **僅具「租戶洞察」角色** 的使用者可讀這些 API／頁面，且 **僅能查自己 `tenant_id`**，以免跨租戶洩漏。 | RBAC | 所有查詢強制 `tenant_id` + 角色檢查 |

---

## 建議實作順序（MVP）

1. **A-1 → A-2 → A-3**（用量／模型／成敗）— 幾乎只吃 `chat_llm_requests`。
2. **B-1 → B-2**（人與排行）。
3. **C-1 → C-2**（thread／agent 視角）。
4. **C-3**（長度／附件統計）。
5. **E-1、E-2**（匯出與權限）。

---

## 與現表的小縫隙（可另開技術 story）

- **`finish_reason`**：參數已有但未入庫 → 若要「截斷率」洞察，可寫入 `chat_llm_requests.extra` 或新欄位。
- **`prompt_type`**：不在 `chat_llm_requests` → 若未來要區分 `chat_agent` vs 其他流程，可於請求完成時寫入 `extra` 或專用欄位。
