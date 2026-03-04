# NeuroSme 2.0 架構說明

以 HomePage 顯示 agents 為例，說明前後端與資料庫的資料流。

---

## 整體架構

```
┌─────────────┐     HTTP      ┌─────────────┐     SQL      ┌─────────────────────┐
│   Frontend  │ ────────────► │   Backend   │ ────────────► │  PostgreSQL         │
│  React +    │   /api/v1/    │     FastAPI │   SQLAlchemy │  agent_catalog       │
│  Tailwind   │   agents/     │             │              │  tenant_agents       │
│             │ ◄──────────── │  SQLAlchemy │ ◄──────────── │  user_agents        │
└─────────────┘    JSON       └─────────────┘    ORM        └─────────────────────┘
```

---

## 資料庫 (PostgreSQL)

**Agent 相關表：**

- **agent_catalog** — 系統全域 agent 定義
  - id (varchar, PK)
  - group_id, group_name, agent_id, agent_name, icon_name

- **tenant_agents** — 客戶買了哪些 agent
  - tenant_id, agent_id (複合 PK)
  - FK: tenant_id → tenants, agent_id → agent_catalog

- **user_agents** — 使用者能用哪些 agent
  - tenant_id, user_id, agent_id (複合 PK)
  - FK: agent_id → agent_catalog

**權限邏輯：** 使用者可存取 agent 的條件 = tenant 已購買（tenant_agents）且 user 已授權（user_agents）

---

## 後端 (FastAPI + SQLAlchemy)

**資料流：** 資料庫 → Model → Schema → API Response

- **Model** — `backend/app/models/agent_catalog.py`：對應 `agent_catalog` 表
- **Schema** — `backend/app/schemas/agent.py`：定義 API 回應格式（Pydantic）
- **API** — `backend/app/api/endpoints/agents.py`：定義 `GET /api/v1/agents/`，依 user_agents ∩ tenant_agents 過濾後從 agent_catalog 查詢並回傳 JSON

**請求流程：**
1. 收到 `GET /api/v1/agents/`
2. 依 `get_agent_ids_for_user()` 取得 user 可存取的 agent_id 集合
3. 從 `AgentCatalog` 查詢對應資料
4. 結果依 `AgentResponse.from_catalog()` 轉成 JSON
5. 回傳給前端

---

## 前端 (React + TypeScript + Tailwind)

**資料流：** API → fetch → 型別 → 元件渲染

- **API** — `frontend/src/api/agents.ts`：呼叫 `getAgents()`，fetch `/api/v1/agents/`
- **型別** — `frontend/src/types/index.ts`：定義 `Agent` 介面
- **頁面** — `frontend/src/pages/HomePage.tsx`：載入 agents、以卡片顯示
- **元件** — `frontend/src/components/AgentIcon.tsx`：依 `icon_name` 顯示圖示

**請求流程：**
1. `HomePage` 掛載時呼叫 `getAgents()`
2. 透過 Vite proxy 轉發到 `http://localhost:8000/api/v1/agents/`
3. 後端回傳 JSON，前端解析為 `Agent[]`
4. 渲染卡片列表，每張卡片顯示 `group_name`、`agent_name`、`AgentIcon`

---

## 完整資料流（以 HomePage 為例）

```
1. 使用者開啟 /
   → HomePage 載入

2. useEffect 執行 getAgents()
   → fetch('/api/v1/agents/')

3. Vite proxy 轉發到 localhost:8000
   → FastAPI 收到請求

4. agents.py: get_agent_ids_for_user() 取得 user_agents ∩ tenant_agents
   → 從 AgentCatalog 查詢對應 agent_id

5. PostgreSQL 回傳 rows
   → 轉成 AgentResponse 列表

6. 回傳 JSON 給前端
   → setAgents(data)

7. HomePage 重新渲染
   → agents.map() 渲染每張卡片
   → AgentIcon 依 icon_name 顯示圖示
```

---

## 目錄結構

```
NeuroSme2.0/
├── frontend/           # 前端
│   └── src/
│       ├── api/        # API 呼叫
│       ├── components/ # 共用元件
│       ├── pages/      # 頁面
│       └── types/      # TypeScript 型別
│
├── backend/            # 後端
│   └── app/
│       ├── api/        # API 路由
│       ├── core/       # 設定、DB 連線
│       ├── models/     # SQLAlchemy 模型
│       └── schemas/    # Pydantic 結構
│
└── docker-compose.yml  # PostgreSQL 容器
```
