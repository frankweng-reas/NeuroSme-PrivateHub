# Agent Package 架構設計

> 記錄日期：2026-04-03  
> 狀態：設計確認，pilot 實作進行中

---

## 背景與目標

- NeuroSme 由多個 agent 組成（BI Agent、Customer Agent、Quotation Agent…未來超過 10 個）
- 目標：每個 agent **獨立 repo 開發**，客戶購買後才「掛上來」
- 技術棧：全部 React + FastAPI
- 現有彈性基礎已存在：`agent_catalog` / `tenant_agents` / `user_agents` 三層設計

---

## 整體架構：Core Shell + Agent Packages

```
NeuroSme2.0/          ← core（殼 + auth + catalog + permission + 共用 UI）
neurosme-agent-bi/    ← BI agent 獨立 repo（pilot）
neurosme-agent-qtn/   ← 未來：Quotation agent
neurosme-agent-xxx/   ← 未來：其他 agent
```

---

## 後端：動態掛 Router

### agent_catalog 新增兩欄（migration 需要）

```python
backend_router = Column(String(255), nullable=True)  # e.g. "neurosme_agent_bi.router"
frontend_key   = Column(String(100), nullable=True)  # e.g. "agent-bi"
```

### core main.py 動態 mount

```python
from importlib import import_module

def mount_agent_routers(app, db):
    agents = db.query(AgentCatalog).filter(AgentCatalog.backend_router != None).all()
    for agent in agents:
        try:
            mod = import_module(agent.backend_router)
            app.include_router(mod.router, prefix=f"/api/agents/{agent.agent_id}")
        except ImportError:
            pass  # 套件未安裝 = 功能未啟用，靜默跳過
```

### 每個 agent repo 的 backend 輸出

```python
# neurosme_agent_bi/router.py
from fastapi import APIRouter
router = APIRouter()

@router.post("/chat")
def chat(...): ...
```

---

## 前端：agentRegistry + lazy import

### 核心概念：@neurosme/core alias

- `@neurosme/core` 是 vite alias，指向 core 的 `./src`
- Agent package 從 `@neurosme/core/components/AgentChat` 等路徑 import 共用元件
- Core vite.config.ts 加兩個 alias：

```typescript
'@neurosme/core': path.resolve(__dirname, './src'),
'@neurosme/agent-bi': path.resolve(__dirname, '../../neurosme-agent-bi/src'),
```

### agentRegistry.ts（核心只需改這一個檔）

```typescript
// src/agentRegistry.ts
import { lazy } from 'react'

const registry: Record<string, () => Promise<{ default: ComponentType<{ agent: Agent }> }>> = {
  'agent-bi': () => import('@neurosme/agent-bi'),
  // 新 agent = 加一行
}

export function getAgentUI(frontendKey: string) {
  const loader = registry[frontendKey]
  if (!loader) return lazy(() => import('./pages/agents/AgentDefaultUI'))
  return lazy(loader)
}
```

### AgentPage.tsx 改用 registry

```tsx
const AgentUI = getAgentUI(agent.frontend_key ?? '')
return (
  <Suspense fallback={<Spinner />}>
    <AgentUI agent={agent} />
  </Suspense>
)
```

---

## Pilot：搬移 BI Agent 的範圍

### 需要從 core 搬到 `neurosme-agent-bi` 的檔案

| 原位置（core） | 新位置（agent-bi） | 說明 |
|---|---|---|
| `frontend/src/pages/agents/AgentBusinessUI.tsx` | `src/AgentBusinessUI.tsx` | 主元件 |
| `frontend/src/components/SchemaManagerOverlayV2.tsx` | `src/SchemaManagerOverlayV2.tsx` | 只有 BI 用 |
| `frontend/src/api/biProjects.ts` | `src/api/biProjects.ts` | BI 專屬 |
| `frontend/src/api/biSchemas.ts` | `src/api/biSchemas.ts` | BI 專屬 |

### 留在 core（共用）的

- `src/api/client.ts`、`src/api/chat.ts`
- `src/components/*`（除 SchemaManagerOverlayV2）
- `src/types/index.ts`（`Agent` 等共用型別）
- `src/constants/aiOptions.ts`

### 其他 agent 目前不動

`AgentCustomerUI.tsx`、`AgentQuotationUI.tsx`、`AgentSchedulingUI.tsx` 先保留在 core，等 pilot 驗證後再依序搬。

---

## Import 路徑對應規則（agent package 內）

| 原來（core 的 `@/`） | 新 package 內 |
|---|---|
| `@/api/client` | `@neurosme/core/api/client` |
| `@/api/chat` | `@neurosme/core/api/chat` |
| `@/components/AgentChat` | `@neurosme/core/components/AgentChat` |
| `@/components/AgentHeader` | `@neurosme/core/components/AgentHeader` |
| `@/components/ConfirmModal` | `@neurosme/core/components/ConfirmModal` |
| `@/components/InputModal` | `@neurosme/core/components/InputModal` |
| `@/components/HelpModal` | `@neurosme/core/components/HelpModal` |
| `@/components/ChartModal` | `@neurosme/core/components/ChartModal` |
| `@/components/AISettingsPanelBasic` | `@neurosme/core/components/AISettingsPanelBasic` |
| `@/components/AISettingsPanelAdvanced` | `@neurosme/core/components/AISettingsPanelAdvanced` |
| `@/constants/aiOptions` | `@neurosme/core/constants/aiOptions` |
| `@/types` | `@neurosme/core/types` |
| `@/api/biProjects` | `./api/biProjects`（relative，同 package） |
| `@/api/biSchemas` | `./api/biSchemas`（relative，同 package） |
| `@/components/SchemaManagerOverlayV2` | `./SchemaManagerOverlayV2`（relative，同 package） |

---

## neurosme-agent-bi 的 package.json

```json
{
  "name": "@neurosme/agent-bi",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./api/biProjects": "./src/api/biProjects.ts",
    "./api/biSchemas": "./src/api/biSchemas.ts"
  },
  "peerDependencies": {
    "react": "^18.0.0",
    "@neurosme/core": "*"
  }
}
```

## neurosme-agent-bi 的 tsconfig.json

```json
{
  "compilerOptions": {
    "paths": {
      "@neurosme/core/*": ["../../NeuroSme2.0/frontend/src/*"],
      "@neurosme/core": ["../../NeuroSme2.0/frontend/src"]
    }
  }
}
```

---

## 需要另外處理

- `DevPipelineInspector.tsx`（dev 工具）：將 `@/api/biProjects` 和 `@/api/biSchemas` 的 import 改為 `@neurosme/agent-bi/api/biProjects` 等
- `agent_catalog` DB migration：加 `backend_router`、`frontend_key` 兩欄
- Backend router 的 mount 邏輯（`main.py`）

---

## 實作順序（已確認的 pilot 步驟）

1. ✅ 建立 `/Users/fweng/neurosme-agent-bi/` repo 基礎結構
2. ⬜ 複製 BI 專屬檔案，更新 import 路徑
3. ⬜ 更新 core `vite.config.ts`：加 `@neurosme/core` 與 `@neurosme/agent-bi` alias
4. ⬜ 更新 core `tsconfig.json`：加對應 paths
5. ⬜ 更新 `AgentPage.tsx` 改用 lazy import
6. ⬜ 刪除 core 的 BI 專屬檔案，修正 `DevPipelineInspector.tsx`
7. ⬜ 推上 GitHub（`neurosme-agent-bi` 需先建立 private repo）
