# Plan：支援多個本機 Ollama Provider（multi-local）

> **狀態**：規劃中，尚未實作  
> **建立日期**：2026-06-30  
> **背景**：目前 NeuroSme 的 `local` provider 只允許一個 Ollama 實例。隨著用戶可能同時擁有多台 GPU 機器（例如：395 本機 + GX10 推理機），需要支援多個本機 Ollama。

---

## 問題描述

目前系統有三個硬性限制（三把鎖），導致只能有一個 local Ollama：

| # | 位置 | 限制 |
|---|------|------|
| 1 | `llm_configs.py` 建立邏輯 | 同一 tenant 不允許兩筆 `provider="local"` |
| 2 | `llm_service._get_llm_params()` | 路由時永遠取第一筆 active local config |
| 3 | `km_service._get_embed_params()` | embedding 也永遠用第一筆 local config |

---

## 設計方案：方案 B — `local:{id}/model`

### 核心格式

模仿現有 `custom:{id}/model` 機制，讓 `local` 支援多實例：

```
local/gemma4:26b        ← 舊格式，向下相容（永遠指向第一筆 active local config）
local:1/gemma4:26b      ← 新格式，明確指定 DB 中 id=1 的 Ollama 設定
local:2/gemma4:26b      ← 第二個 Ollama 實例（不同 api_base URL）
```

### 為何選擇方案 B

| 優點 | 說明 |
|------|------|
| 零 DB Schema 變更 | 使用現有 `id` 欄位，不需要 migration |
| Backward Compatible | 舊 `local/model` 字串繼續有效，現有租戶資料不受影響 |
| 與 custom:{id} 一致 | 開發者已有成熟參考路徑 |
| 可擴展 | 新增第三台只要在 DB 加一筆 config |

---

## 需要修改的檔案

### 後端（Backend）

#### 1. `backend/app/services/llm_utils.py`（影響最廣、改動最少）

```python
# get_provider_from_model：加 local: 前綴偵測
if m.startswith("local/") or m.startswith("local:"):
    return "local"

# resolve_litellm_model：解析 local:{id}/model_name
if model.startswith("local/"):
    return f"ollama_chat/{model[6:]}"
if model.startswith("local:") and "/" in model:          # ← 新增
    return f"ollama_chat/{model.split('/', 1)[1]}"

# ensure_local_prefix：向下相容
if m.startswith("local/") or m.startswith("local:"):    # ← 加條件
    return m
```

#### 2. `backend/app/services/llm_service.py` — `_get_llm_params()`

核心路由邏輯：解析 `local:{id}/model` 並查詢對應 config。

```python
if model.startswith("local/") or model.startswith("local:"):
    if model.startswith("local:") and "/" in model:
        # 新格式：解析 id
        rest = model[len("local:"):]
        config_id, model_name = rest.split("/", 1)
        cfg = db.query(LLMProviderConfig).filter(
            LLMProviderConfig.id == int(config_id),
            LLMProviderConfig.provider == "local",
            LLMProviderConfig.tenant_id == tenant_id,
        ).first()
        api_base = cfg.api_base_url if cfg else "http://localhost:11434"
        api_key  = decrypt(cfg.api_key_encrypted) if cfg and cfg.api_key_encrypted else "local"
    else:
        # 舊格式 local/model → 取第一筆（backward compat）
        model_name = model[6:]
        cfg = first_active_local_config(...)
        api_base = cfg.api_base_url if cfg else "http://localhost:11434"
        api_key  = "local"
    return LLMResolveResult(
        litellm_model=f"ollama_chat/{model_name}",
        api_base=api_base,
        api_key=api_key,
    )
```

#### 3. `backend/app/services/km_service.py` — `_get_embed_params()`

仿照 `custom:{id}` 的處理邏輯，新增 `local:{id}` 分支。

#### 4. `backend/app/api/endpoints/llm_configs.py`

- **create**：解除 `local` 單例限制；多筆時強制填寫 `label`
- **test**：`_collect_tenant_model_options()` 輸出 `local:{id}/model`（多筆時）
- **build_model_options**：多筆 local config 各自輸出帶 `label` 的模型選項

修改 `_collect_tenant_model_options()` 輸出邏輯：

```python
# 現在：輸出 "local/gemma4:26b"
# 改成（有多筆 local 時）：
for cfg in local_configs:
    for model in cfg.available_models:
        mid = f"local:{cfg.id}/{model}" if len(local_configs) > 1 else f"local/{model}"
        note = cfg.label or "本機 Ollama"
        add_model(mid, note)
```

#### 5. `document_parse.py` / `doc_refiner.py` — `is_local` 偵測

```python
# 現在：
is_local = use_model.startswith("local/") or use_model.startswith("ollama_chat/")

# 改成（用統一 parser）：
from app.services.llm_utils import get_provider_from_model
is_local = get_provider_from_model(use_model) == "local" or use_model.startswith("ollama_chat/")
```

#### 6. `backend/app/services/document_structuring/llm_resolve.py`

`resolve_tenant_model()` 中的 local 分支需處理 `local:{id}/` 前綴：

```python
if provider == "local":
    # dm 可能是 "gemma4:26b"（純 model 名稱，沒有前綴）
    # 若只有一筆 local config：輸出 local/dm
    # 若有多筆：輸出 local:{cfg.id}/dm
    return f"local:{cfg.id}/{dm}" if multiple_locals else f"local/{dm}"
```

### 前端（Frontend）

#### `frontend/src/pages/admin/AdminLLMSettings.tsx`

- 允許新增多張 `local` provider 卡片（現在限制只能一張）
- 每張卡片顯示 **標籤（Label）** 欄位，多筆時必填
- 模型下拉選單顯示來源標籤，例如：`gemma4:26b（GX10 推理機）`
- Embedding 下拉：`本機 Ollama（GX10 推理機）` vs `本機 Ollama（395 本機）`

---

## 不需要修改的檔案

以下程式碼使用 `provider == "local"`（由 `get_provider_from_model()` 解析而來），只要更新 `llm_utils.py`，這些地方自動正確：

- `speech.py` — local 語音識別邏輯
- `chat.py` — 使用解析後的 `litellm_model`（`ollama_chat/xxx`）
- `km_service.py` — log 顯示用的 `provider == "local"` 判斷
- 所有 DB Schema / Alembic Migration — **零變更**

---

## Backward Compatibility 保證

| 現有資料 | 行為 |
|---------|------|
| `default_llm_model = "local/gemma4:26b"` | fallback 到第一筆 active local，繼續運作 |
| `allowed_models` 含 `local/gemma4:26b` | 同上 |
| `embedding_provider = "local"` | 取第一筆 local config，行為不變 |
| 只有一台 local 的租戶 | `local/model` 舊格式仍有效，UI 可不改 |

---

## 工作量估計

| 類別 | 複雜度 | 工作天 |
|------|--------|-------|
| `llm_utils.py` | 低（純字串 parse） | 0.25 天 |
| `llm_service.py` | 中（DB 查詢 ~20 行） | 0.5 天 |
| `km_service.py` | 中（仿 custom 邏輯） | 0.5 天 |
| `llm_configs.py` | 中（create/test/list） | 0.5 天 |
| `document_parse` / `doc_refiner` | 低（is_local 改一行） | 0.25 天 |
| Frontend `AdminLLMSettings` | 高（多卡片 UX） | 1.5 天 |
| 測試與驗證 | 中 | 1 天 |
| **合計** | | **~4.5 天** |

---

## 實作順序建議

```
1. llm_utils.py            ← 最底層，先改，讓 parse 正確
2. llm_service.py          ← 路由核心
3. km_service.py           ← embedding 路由
4. llm_configs.py          ← API 層解除限制
5. document_parse/refiner  ← is_local 修正
6. llm_resolve.py          ← fallback 邏輯
7. Frontend                ← UI 最後改
8. 端對端測試              ← 舊資料 + 新格式並存驗證
```

---

## 測試情境（實作完後需驗證）

- [ ] 單一 local config 租戶：舊 `local/model` 格式仍正常聊天
- [ ] 單一 local config 租戶：embedding 正常
- [ ] 兩個 local config 租戶：`local:1/model` 路由到第一台 api_base
- [ ] 兩個 local config 租戶：`local:2/model` 路由到第二台 api_base
- [ ] 兩個 local config 租戶：embedding 可分別選擇不同實例
- [ ] 模型下拉正確顯示 label 區分
- [ ] 其中一台離線：錯誤訊息清楚，另一台不受影響
- [ ] document_parse 使用 local:{id}/model 正常解析文件

---

*最後更新：2026-06-30*
