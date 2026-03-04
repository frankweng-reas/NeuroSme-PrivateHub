# agents / tenant_agents / user_agents 結構調整計畫

## 目標結構

| 表 | 用途 |
|----|------|
| **agents** | 系統 catalog，全域 agent 定義（無 tenant_id） |
| **tenant_agents** | 客戶買了哪些 agent（tenant_id, agent_id） |
| **user_agents** | 使用者能用哪些 agent（user_id, agent_id） |

## 目前 vs 目標

**目前：**
- `agents`：有 tenant_id、is_purchased，每個 tenant 一份 agent 資料
- `user_agents`：tenant_id, user_id, agent_id
- 無 `tenant_agents`

**目標：**
- `agents`：移除 tenant_id、is_purchased，改為全域 catalog
- 新增 `tenant_agents`：tenant_id, agent_id
- `user_agents`：移除 tenant_id，改為 user_id, agent_id（agent_id 參照 agents.id）

---

## 需修改的檔案

### 1. 後端 Model

| 檔案 | 變更 |
|------|------|
| `backend/app/models/agent.py` | 移除 tenant_id、is_purchased；PK 改為 id |
| 新增 `backend/app/models/tenant_agent.py` | TenantAgent(tenant_id, agent_id) |
| `backend/app/models/user_agent.py` | 移除 tenant_id；FK agent_id → agents.id |
| `backend/app/models/__init__.py` | 匯入 TenantAgent |

### 2. 後端 Schema

| 檔案 | 變更 |
|------|------|
| `backend/app/schemas/agent.py` | id 改為 agents.id（不再用 tenant_id:id）；移除 is_purchased、tenant_id |

### 3. 後端 API / Service

| 檔案 | 變更 |
|------|------|
| `backend/app/api/endpoints/agents.py` | 依 user.tenant_id 查 tenant_agents + user_agents，過濾出可用的 agents |
| `backend/app/services/permission.py` | 改為：tenant 有買 + user 有授權 才回傳 agent_id |
| `backend/app/api/endpoints/users.py` | agent_ids 格式改為純 id（或維持 tenant_id:id 視需求） |
| `backend/app/api/endpoints/chat.py` | _check_agent_access 改為查 tenant_agents + user_agents |
| `backend/app/api/endpoints/source_files.py` | agent 識別改為 (tenant_id, agent_id) 或僅 agent_id |
| `backend/app/api/endpoints/prompt_templates.py` | 同上 |

### 4. 後端 Model 關聯（SourceFile、PromptTemplate）

| 檔案 | 變更 |
|------|------|
| `backend/app/models/source_file.py` | 維持 tenant_id, agent_id（因同一 agent 在不同 tenant 的檔案不同） |
| `backend/app/models/prompt_template.py` | 同上 |

### 5. 前端

| 檔案 | 變更 |
|------|------|
| `frontend/src/types/index.ts` | Agent 移除 is_purchased、tenant_id（若 API 不再回傳） |
| `frontend/src/api/agents.ts` | is_purchased 參數改為查 tenant 已購買（後端邏輯） |
| `frontend/src/api/users.ts` | agent_ids 格式若改需對應 |
| `frontend/src/pages/admin/AdminAgentPermissions.tsx` | 權限設定改為：列出 tenant_agents 的 agents，勾選寫入 user_agents |

### 6. Migration

需新增 migration（建議編號 017）：
1. 建立 `agent_catalog` 暫存表（或直接改 agents）
2. 建立 `tenant_agents` 表
3. 從現有 agents 匯入：每個 (tenant_id, id) → agent_catalog 一筆；tenant_agents 一筆（若 is_purchased）
4. 改 `user_agents`：移除 tenant_id，FK → agents.id
5. 改 `agents`：移除 tenant_id、is_purchased，PK 改為 id
6. 刪除暫存表（若用暫存）

**注意：** source_files、prompt_templates 的 (tenant_id, agent_id) 需保留，因同一 agent 在不同 tenant 有不同檔案/範本。

---

## 權限邏輯（調整後）

```
使用者可存取 agent 的條件：
1. 使用者的 tenant 在 tenant_agents 有該 agent（tenant 已購買）
2. 使用者在 user_agents 有該 agent（已授權）
```

---

## 建議實作順序

1. 撰寫 migration（含資料遷移）
2. 修改 Model（Agent、TenantAgent、UserAgent）
3. 修改 permission service
4. 修改 agents API
5. 修改 chat、source_files、prompt_templates、users API
6. 修改 Schema
7. 修改前端
8. 測試
