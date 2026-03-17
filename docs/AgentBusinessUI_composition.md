# AgentBusinessUI 組成說明

商務型 agent 專用 UI，當 `agent_id` 含 `business` 時使用。

## 共用元件

- **AgentHeader**（`@/components/AgentHeader`）：頁面標題列
- **SourceFileManager**（`@/components/SourceFileManager`）：左欄，來源檔案管理（列表、上傳、選用、編輯、刪除）
- **AgentChat**（`@/components/AgentChat`）：中欄，對話區（訊息列表、輸入框、送出）
- **AISettingsPanel**（`@/components/AISettingsPanel`）：右欄，AI 設定（模型、角色、語言、詳細度、自訂提示、範本）
- **ConfirmModal**（`@/components/ConfirmModal`）：清除對話確認彈窗

## 佈局

- **react-resizable-panels**：左、中、右三欄可拖曳調整大小
- **左欄**：SourceFileManager，可折疊
- **中欄**：AgentChat
- **右欄**：AISettingsPanel，可折疊

## API

- `chatCompletionsComputeTool`（`@/api/chat`）：發送對話請求（Intent 萃取 → 後端計算 → 文字生成）

## 常數

`ROLE_OPTIONS`、`LANGUAGE_OPTIONS`、`DETAIL_OPTIONS`（`@/constants/aiOptions`）
- 由 **AISettingsPanel** 與 **AgentBusinessUI** 共用。每項含 `value`、`label`、`prompt`
- **AISettingsPanel**：用 `label` 顯示選項（如「繁中」）、用 `value` 回傳選中值（如 `zh-TW`）
- **AgentBusinessUI**：收到 `value` 後，`buildUserPrompt()` 依 `value` 查常數取得 `prompt`（如「請用繁體中文回覆。」），一併送給 API

## 狀態持久化

- 使用 `localStorage`（key: `agent-business-ui-{agentId}`）儲存：訊息、userPrompt、model、role、language、detailLevel、selectedTemplateId
- 切換 agent 時會載入對應的儲存狀態
