# Prompt Templates 表設計

## 用途
儲存用戶自訂的 AI 設定範本（User Prompt 內容），可重複套用。

## 表：`prompt_templates`

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | Integer, PK, autoincrement | 主鍵 |
| `user_id` | Integer, FK → users.id, CASCADE | 建立者 |
| `tenant_id` | String(100), FK → tenants.id, RESTRICT | 租戶 |
| `agent_id` | String(100), NOT NULL | 所屬 agent |
| `name` | String(255) | 範本顯示名稱 |
| `content` | Text | User Prompt 內容（資料辭典、輸出格式等） |
| `created_at` | DateTime(timezone) | 建立時間 |
| `updated_at` | DateTime(timezone) | 更新時間 |

## 約束與索引

- **唯一約束**：`(user_id, tenant_id, agent_id, name)`  
  - 同一用戶、同一 agent 下範本名稱不重複

- **複合索引**：`(user_id, tenant_id, agent_id)`  
  - 查詢「某用戶在某 agent 下的範本列表」時使用

## 關聯

```
users ──1:N──> prompt_templates
tenants ──1:N──> prompt_templates
agents (tenant_id, id) ── 邏輯關聯 ──> prompt_templates.agent_id
```

> `agent_id` 不設 FK；查詢時由 `tenant_id + agent_id` 限定範圍。範本皆為 agent 專用。

## 擴充考量（可選，之後再加）

若要做「完整套用」（含 model、role、language、detail_level）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `model` | String(100), nullable | 覆寫模型 |
| `role` | String(50), nullable | 覆寫角色 |
| `language` | String(20), nullable | 覆寫語言 |
| `detail_level` | String(50), nullable | 覆寫詳細程度 |

目前先以 `content` 為主，其餘由前端維持既有選項。
