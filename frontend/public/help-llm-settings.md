# AI 模型選型指南

本文件整理本系統已驗證的 AI 模型資訊，供管理員設定 Provider 與 Model 時參考。

> **本文件不是白名單。** 下方清單僅為建議與已測試過的模型。只要是我們支援的 Provider，管理員可在「可用 Models」自由新增任何 Model ID；格式正確、上游 API 支援該模型，且連線設定無誤，即可調用。新增後請用「測試」按鈕驗證。

> **備註欄位（note）**：在新增 Model 時，可填入備註供使用者辨識，例如「速度快・適合日常問答」、「長文摘要✓」。備註會顯示在使用者的模型下拉選單中。

---

## Provider 概覽

| Provider | 代碼 | 適用場景 | 需要 API Key |
|----------|------|---------|-------------|
| OpenAI | `openai` | 通用、高品質、多語言 | ✅ |
| Google AI Studio | `gemini` | 長上下文、多模態、中文 | ✅ |
| Google Vertex AI | `vertex` | 企業 GCP 部署、合規與 IAM 控管 | Service Account JSON（選填） |
| Anthropic | `anthropic` | Claude 系列，推理與長文能力強 | ✅ |
| 本機模型 | `local` | 私有部署、離線、免費（Ollama / LM Studio） | 通常不需要 |

---

## Model ID 前綴對照

Model ID 的前綴決定系統如何路由到正確的 Provider。**前綴錯誤會連到錯誤的連線設定。**

| Provider | 前綴規則 | 範例 |
|----------|---------|------|
| OpenAI | 无前綴 | `gpt-4o-mini` |
| Google AI Studio | `gemini/` | `gemini/gemini-2.5-flash` |
| Google Vertex AI | `vertex_ai/` | `vertex_ai/gemini-2.5-pro` |
| Anthropic | `anthropic/` | `anthropic/claude-sonnet-4-5` |
| 本機 (Ollama / LM Studio) | `local/` | `local/llama3.2:latest` |

---

## LLM 模型清單

### OpenAI

| Model ID | 上下文 | 特色 | 建議備註 |
|----------|--------|------|---------|
| `gpt-4.1` | 1M | 最新旗艦，推理能力強，支援超長文 | 高品質・長文✓ |
| `gpt-4.1-mini` | 1M | 4.1 輕量版，速度快、費用低 | 速度快・日常問答 |
| `gpt-4o` | 128K | 多模態旗艦，視覺+文字，多語言強 | 多模態・高品質 |
| `gpt-4o-mini` | 128K | 4o 輕量版，CP 值極高 | 速度快・費用低 |
| `o3-mini` | 200K | 推理模型，適合邏輯分析 | 推理強・較慢 |
| `o4-mini` | 200K | 新一代推理模型，速度優於 o3-mini | 推理快✓ |

> **Model ID 格式**：直接填寫上表的 ID，例如 `gpt-4o-mini`。

---

### Google AI Studio（Gemini）

| Model ID | 上下文 | 特色 | 建議備註 |
|----------|--------|------|---------|
| `gemini/gemini-2.5-flash` | 1M | 速度快、費用低、長文處理佳 | 速度快・長文✓ |
| `gemini/gemini-2.5-pro` | 1M | Gemini 旗艦，推理與中文均優秀 | 高品質・中文✓ |
| `gemini/gemini-3.1-flash-lite` | 1M | 輕量 Flash，成本更低 | 速度快・費用低 |
| `gemini/gemini-2.0-flash` | 1M | 穩定版 Flash，適合生產環境 | 穩定・速度快 |

> **Model ID 格式**：必須加上 `gemini/` 前綴，例如 `gemini/gemini-2.5-flash`。

---

### Google Vertex AI

Vertex AI 適合已在 Google Cloud 部署、需透過 GCP IAM 與 Service Account 控管存取權限的企業環境。與 Google AI Studio 不同，Vertex AI 走 GCP 計費與專案隔離，**不需填寫 API Base URL**。

| Model ID | 上下文 | 特色 | 建議備註 |
|----------|--------|------|---------|
| `vertex_ai/gemini-2.5-flash` | 1M | 速度快、費用低、長文處理佳 | 速度快・長文✓ |
| `vertex_ai/gemini-2.5-pro` | 1M | Gemini 旗艦，推理與中文均優秀 | 高品質・中文✓ |

> **Model ID 格式**：必須加上 `vertex_ai/` 前綴，例如 `vertex_ai/gemini-2.5-flash`。

**設定欄位說明：**

| 欄位 | 必填 | 說明 |
|------|------|------|
| GCP Project ID | ✅ | GCP 專案 ID，例：`my-gcp-project-123` |
| GCP Region | ✅ | Vertex AI 服務所在區域，例：`us-central1`、`asia-east1` |
| Service Account JSON | 選填 | 貼上具 Vertex AI User 權限的 Service Account 金鑰 JSON |

> **認證方式**：若 NeuroSme 部署在 GCP VM 且已掛載預設 Service Account，Service Account JSON 可留空，系統會自動使用 VM 的 Application Default Credentials（ADC）連線。

---

### Anthropic（Claude）

| Model ID | 上下文 | 特色 | 建議備註 |
|----------|--------|------|---------|
| `anthropic/claude-opus-4-5` | 200K | Claude 最強旗艦，複雜推理 | 高品質・推理✓ |
| `anthropic/claude-sonnet-4-5` | 200K | 速度與品質均衡，日常首選 | 均衡・日常問答 |
| `anthropic/claude-3-5-haiku-20241022` | 200K | 輕量快速，成本最低 | 速度快・費用低 |

> **Model ID 格式**：必須加上 `anthropic/` 前綴，例如 `anthropic/claude-sonnet-4-5`。

---

### 本機模型（Local / Ollama / LM Studio）

本機 Provider 代碼為 `local`，Model ID 一律使用 **`local/`** 前綴（系統內部會轉換為 Ollama 連線格式）。

#### Ollama 常用模型

| Model ID | 上下文 | 特色 | 建議備註 |
|----------|--------|------|---------|
| `local/llama3.3` | 128K | Meta 旗艦，多語言佳 | 多語言・免費 |
| `local/llama3.2:latest` | 128K | 穩定版 Llama，適合生產 | 穩定・免費 |
| `local/llama3.1:8b` | 128K | 輕量版，適合低資源環境 | 輕量・速度快 |
| `local/qwen2.5:72b` | 128K | 阿里雲大模型，繁體中文優秀 | 中文✓・免費 |
| `local/qwen2.5:7b` | 128K | Qwen 輕量版，中文表現仍佳 | 中文✓・輕量 |
| `local/mistral:latest` | 32K | 歐洲開源，英文強 | 英文✓・免費 |
| `local/gemma4:26b` | 128K | Google Gemma 系列 | 多語言・免費 |
| `local/deepseek-r1:7b` | 128K | 推理模型，數學/邏輯分析 | 推理強・免費 |

> **Model ID 格式**：必須加上 `local/` 前綴，後接 Ollama 中的模型名稱，例：`local/llama3.2:latest`。填入前請先執行 `ollama pull <模型名稱>`。

> **API Base URL**：
> - Ollama 預設：`http://localhost:11434`
> - 遠端部署：`http://192.168.1.10:11434`
> - NeuroSme 在 Docker 內、Ollama 在宿主機：`http://host.docker.internal:11434`（勿填 `localhost`，容器內 localhost 指向容器本身）

#### LM Studio

- API Base URL：`http://localhost:1234`（LM Studio 預設）
- Model ID：加上 `local/` 前綴 + LM Studio 所載入的模型名稱（可在 LM Studio 介面中查看）

---

## Embedding 模型

Embedding 模型用於知識庫文件的向量化，**一旦鎖定後更換需重新上傳所有文件**，請謹慎選擇。

| 模型 | Provider | 維度 | 備註 |
|------|----------|------|------|
| `text-embedding-3-small` | OpenAI | 768（截斷） | 雲端 Embedding 預設推薦 |
| `nomic-embed-text` | Local (Ollama) | 768（原生） | 本機 Embedding 首選，與系統 schema 一致 |

> 本機 Embedding 請先執行：`ollama pull nomic-embed-text`

---

## 常見問題

### Q：本文件沒列出的模型可以用嗎？
可以。本文件只是參考清單，不是限制。在 Provider 連線設定的「可用 Models」手動新增 Model ID（含正確前綴），再用「測試」驗證即可。前提是上游 Provider 確實提供該模型，且 API Key / 連線設定正確。

### Q：Model ID 填錯會怎樣？
系統在測試時會直接打 API，若 ID 不正確會出現連線錯誤。請使用「測試」按鈕驗證。

### Q：Google AI Studio 與 Vertex AI 有什麼差別？
Google AI Studio 使用 API Key，適合快速試用或小規模部署。Vertex AI 走 GCP 專案計費，需設定 Project ID 與 Region，適合已有 GCP 基礎設施、需 IAM 控管與合規稽核的企業環境。兩者 Model ID 前綴不同：AI Studio 用 `gemini/`，Vertex AI 用 `vertex_ai/`。

### Q：可以同時啟用多個 Provider 嗎？
可以。每個 Provider 獨立設定，使用者在 AI 設定面板選擇的 Model 決定使用哪個 Provider。

### Q：備註（note）應該寫什麼？
建議寫能讓使用者快速理解的短句，例如：
- `速度快・適合日常問答`
- `高品質・長文摘要✓`
- `中文優化・企業 GCP 部署`
