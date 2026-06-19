# Agent BI 架構說明

## 概覽

Agent BI 是一個 multi-step tool calling 架構，使用者用自然語言提問，由 orchestrator agent 自主決定要查幾次、查什麼，最後統整成分析報告。

---

## 三大核心優勢

**1. AI Agent 自主分析**
不只是問答，而是真正的自主推理。系統會根據您的問題，自動規劃查詢策略、逐步挖掘資料、整合多維度結果，最終輸出包含數字、結論與建議的完整分析報告——全程零人工介入。

**2. 自研語意引擎，精準讀懂您的問題**
我們自主研發的語意轉換技術，將自然語言問題精確轉換為資料查詢，理解時間語意（「上個季度」、「同期比較」）、業務維度（通路、品牌、品類）與複合條件，確保每一個分析數字都來自您的真實資料，不假設、不捏造。

**3. 原始資料不離開您的環境**
所有資料計算在您的伺服器本地執行，送給 AI 模型的只有彙總後的統計數字，原始交易明細永遠留在您手中。享受雲端 AI 的分析能力，同時保有企業級的資料主權。

---

## 資料安全說明

我們的 Agent BI 僅將**彙總後的統計數字**（如各通路月銷售額）送給 AI 模型判讀，**原始交易明細永遠留在您的伺服器本地**，DuckDB 計算在本地執行，不會傳送任何原始資料到雲端。

資料安全由所選用的 AI 模型供應商（如 Google Gemini、OpenAI）的企業資料處理條款保障，我們可提供相關文件供您的資安團隊審閱。

---

## 流程

```
使用者提問
    ↓
Orchestrator LLM（看完整 schema → 自主規劃查詢策略）
    ↓
呼叫 run_bi_query 工具（自然語言描述查詢需求）
    ↓
Intent 萃取 LLM（自然語言 → Intent v4 JSON）
    ↓
DuckDB 計算（Intent JSON → SQL 執行）
    ↓
結果回傳給 Orchestrator
    ↓
（重複上述工具呼叫，直到資料足夠）
    ↓
Orchestrator 輸出 Markdown 分析報告
```

---

## 關鍵設計決策

### Orchestrator 如何知道有哪些欄位？
Schema（欄位清單、維度層級）塞在 `run_bi_query` 工具的 `description` 裡，LLM 在每次決策時都能看到完整欄位定義，因此能自主選擇合適的分析維度。

### Orchestrator 不需要懂 Intent v4
Orchestrator 只用自然語言描述「要查什麼」，底層的 Intent 萃取流程與一般 BI 分析完全相同，格式問題被完全隔離在工具內部。

### Schema 來源
每次請求都從 PostgreSQL `bi_schemas` 表即時讀取，沒有快取。修改 schema 定義後，下一次查詢立即生效。Agent BI 與一般 BI 分析共用同一份 schema，不會不同步。

---

## 執行限制

- 最多 6 步（`MAX_AGENT_STEPS = 6`）
- 若工具回傳空結果，Orchestrator 須在報告中明確說明（不得捏造數字）

---

## 程式碼位置

| 檔案 | 說明 |
|------|------|
| `backend/app/api/endpoints/agent_bi.py` | Orchestrator loop、工具定義、SSE 串流 |
| `backend/app/api/endpoints/chat_compute_tool.py` | Intent 萃取、DuckDB 計算（共用） |
| `backend/app/services/schema_loader.py` | Schema 讀取（共用） |
| `frontend/src/pages/AgentLabPage.tsx` | 開發測試頁（`/agent-lab`） |
| `frontend/src/pages/agents/AgentBusinessUI.tsx` | 正式 BI Agent UI |

---

## 兩個 Endpoint

| Endpoint | 用途 | SSE 格式 |
|----------|------|---------|
| `POST /api/v1/agent/bi-stream` | 實驗頁專用，可指定模型 | `{type: start/thinking/tool_call/tool_result/done/error}` |
| `POST /api/v1/chat/completions-agent-bi-stream` | AgentBusinessUI，使用 tenant 設定的分析模型 | 與原本 BI 格式相容 `{stage: done, ...}` |
