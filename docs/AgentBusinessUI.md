# AgentBusinessUI

**路徑**：`frontend/src/pages/agents/AgentBusinessUI.tsx`

商務型 Agent 專用頁面，當 `agent_id` 含 `business` 時由 `AgentPage` 渲染此元件。

## Props

```ts
interface AgentBusinessUIProps {
  agent: Agent
}
```

## 架構

三欄式 layout，使用 `react-resizable-panels` 的 `Group` + `Panel`，可拖曳調整寬度。左、右欄 `collapsible`，可折疊。

- **左欄**：`SourceFileManager`，管理該 Agent 的來源檔案（CSV）；標題列右側有 Help 按鈕，點擊顯示 Online Help
- **中欄**：對話區，訊息列表 + 輸入 form，呼叫 `chatCompletions`
- **右欄**：AI 設定，Model 下拉選單、User Prompt textarea

## 狀態

- `messages`：`Message[]`，user / assistant 對話紀錄
- `model`：選用的 LLM，預設 `gpt-4o-mini`
- `userPrompt`：傳給後端的額外 prompt（輸出語言、格式等）
- `input`：輸入框內容
- `isLoading`：是否正在請求 API

## localStorage

Key：`agent-business-ui-{agentId}`

儲存 `messages`、`userPrompt`、`model`，頁面載入時 `loadStored` 還原，變更時 `saveStored` 寫回。

## 前端 API

`chatCompletionsComputeTool`（`@/api/chat`）：POST `/api/v1/chat/completions-compute-tool`，傳入 `agent_id`、`project_id`、`model`、`content`。採用 Intent 萃取 → 後端計算 → 文字生成流程。

---

## 後端處理

**路徑**：`backend/app/api/endpoints/chat_compute_tool.py`

### Endpoint

`POST /api/v1/chat/completions-compute-tool`，需 JWT 認證。

### 流程

1. **權限檢查**：`_check_agent_access(db, current, agent_id)` 驗證 user 有權存取該 agent，回傳 `(tenant_id, agent_id)`。支援 `tenant_id:id` 或僅 `id`（用 user.tenant_id 補上）。

2. **資料取得**：`_get_bi_sources_content(db, user_id, project_id)` 取得 BI 專案的資料（CSV/DuckDB），經 `parse_csv_content` 轉為 rows。

3. **System Prompt**：意圖萃取用 `system_prompt_analysis_intent_tool.md`，文字生成用 `system_prompt_analysis_text_tool.md`。

4. **意圖萃取**：LLM 依 schema 與問題輸出 intent JSON。

5. **後端計算**：`compute_aggregate(rows, intent)` 產生 chart_result。

6. **文字生成**：LLM 依 chart_result 撰寫分析文字，回傳 `{ content, chart_data }`。

7. **Model 路由**：`_get_llm_params(model)` 依 prefix 決定 provider；**呼叫 LiteLLM**：`litellm.acompletion`，timeout 60s。

### 錯誤處理

- 400：`agent_id` 為空
- 403：無權限存取 agent
- 404：Agent 不存在
- 413：參考資料超過字元上限（預設 100,000 字元），請減少選用的來源檔案
- 503：API Key 或 TWCC_API_BASE 未設定

---

## Online Help

- 左欄「來源」標題右側有 Help 按鈕（問號圖示）
- 點擊後以 modal 顯示 `help.md` 內容（Markdown 渲染）
- **共用元件**：`HelpModal`（`@/components/HelpModal`），支援動態 `url` 指定 help 檔
- **來源**：`frontend/public/help-sourcefile.md`（來源檔案說明）
- **Docker**：將 `./frontend/public/help-sourcefile.md` volume 掛載至前端 static root，改檔即生效無需 rebuild

## 相依

- `SourceFileManager`、`ConfirmModal`、`HelpModal`、`AgentIcon`
- `chatCompletions`、`ApiError`
- `react-resizable-panels`、`react-markdown`、`lucide-react`
