# DGX Spark LLM Server（GB10）

> **用途**：Dedicated Ollama LLM 推論機，**不部署 NeuroSme**。  
> **主機**：`test@100.116.108.68`（Tailscale）／主機名 `gx10-ed3d`  
> **最後更新**：2026-06-30

AMD 三實例架構請見 [`ollama-server-setup-guide.md`](./ollama-server-setup-guide.md)。  
NeuroSme 後台 LLM 設定欄位請見 [`ollama-server-quickstart.md`](./ollama-server-quickstart.md)。

---

## 1. 硬體與平台

| 項目 | 規格 |
|------|------|
| 平台 | **NVIDIA DGX Spark**（ASUS **GX10**） |
| CPU | ARM64（Cortex-X925 + Cortex-A725，20 核） |
| GPU | **NVIDIA GB10** × 1（Compute Capability **12.1 / SM121**） |
| 記憶體 | 121 GB 統一記憶體（UMA，CPU/GPU 共用） |
| 磁碟 | 916 GB NVMe |
| OS | Ubuntu 24.04.4 LTS |
| Kernel | `6.17.0-1021-nvidia` |
| Driver / CUDA | 580.159.03 / **13.0.3** |
| DGX 韌體 | 7.5.0（2026-06-24） |
| 序號 | W1MSAG0004032N4 |

### 網路

| 介面 | 位址 | 用途 |
|------|------|------|
| Tailscale | `100.116.108.68` | 對外 API 連線（主要） |
| 區域網 | `192.168.10.204/24` | 本機 LAN |
| SSH | port 22 | 維護 |

---

## 2. 架構（單一 Ollama）

```
外部 Client（NeuroSme / curl / LiteLLM / …）
        │
        ▼
  Ollama :11434          ← 唯一入口，監聽 0.0.0.0
        │
        └── gemma4:26b（常駐 GPU，~20 GB）
```

**為什麼不用三實例？**

- GB10 為 **121 GB UMA**，三實例各載入 `gemma4:26b` 容易記憶體競爭。
- 三實例 + Nginx LB 是 **AMD Vulkan** 環境的 workaround（見 AMD 指南），不適用 GB10。
- 單實例 + `OLLAMA_NUM_PARALLEL=3` 可同時處理 3 路請求（2026-06-30 實測穩定）。

**已移除的舊設定（AMD 誤植，勿恢復）**

- `ollama2` / `ollama3` systemd service
- Nginx `ollama-lb.conf`（11434 upstream）
- `OLLAMA_VULKAN=1`、`VK_ICD_FILENAMES=radeon_icd.json`

---

## 3. Ollama 設定

設定檔：`/etc/systemd/system/ollama.service.d/override.conf`

```ini
[Service]
# DGX Spark GB10 — single LLM server (gemma4:26b)
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
Environment="OLLAMA_LLM_LIBRARY=cuda_v13"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_NUM_PARALLEL=3"
Environment="OLLAMA_REQUEST_TIMEOUT=600"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
```

### 環境變數說明

| 變數 | 值 | 說明 |
|------|-----|------|
| `OLLAMA_HOST` | `0.0.0.0:11434` | Tailscale / 內網直連 |
| `OLLAMA_LLM_LIBRARY` | `cuda_v13` | **GB10 SM121 必須**；`cuda_v12` 不支援 cc=12.1 |
| `OLLAMA_FLASH_ATTENTION` | `1` | GB10 上顯著加速 |
| `OLLAMA_MAX_LOADED_MODELS` | `1` | UMA 記憶體管理，避免多模型搶 RAM |
| `OLLAMA_KEEP_ALIVE` | `-1` | 模型常駐（26B 單一模型可接受） |
| `OLLAMA_NUM_PARALLEL` | `3` | 同模型 3 路並發（見下） |
| `OLLAMA_REQUEST_TIMEOUT` | `600` | 長推理 / 大 context 防逾時 |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | 降低 KV cache 記憶體（NVIDIA txt2kg 建議） |

### 平行處理（`NUM_PARALLEL`）

目前 **`3`**（2026-06-30 實測：`gemma4:26b` + Ollama 0.30.10 穩定，3 路同時 ~35 tok/s、GPU ~86%）。

| 場景 | 建議 |
|------|------|
| 幾乎單人使用 | `1`（單請求較快、KV cache 較省） |
| 1～3 人同時 chat / 解析 | `3`（目前值）✅ |
| 4 人以上高並發 | 勿再調高 parallel；硬體上限約 3 路 |
| `gemma4:26b` 設到 **4** | **不建議** — GB10 有 segfault 回報（[ollama#15318](https://github.com/ollama/ollama/issues/15318)） |

**注意**：Client 若送大 `num_ctx`（如 NeuroSme 文件解析 128K），每個 parallel slot 都會保留 KV cache。若 OOM 或變慢，可降回 `2`。

### 模型

| 模型 | 用途 | 大小 | 狀態 |
|------|------|------|------|
| `gemma4:26b` | Chat / 推理 LLM | ~17 GB（載入後 ~20 GB） | ✅ 已部署 |
| `nomic-embed-text` | Embedding | ~274 MB | ⬜ 尚未部署（若 Client 需要 KB 向量再 pull） |

> **gemma4:26b 為 thinking 模型**：API 回應可能主要在 `thinking` 欄位，整合時請確認 Client 解析邏輯。

---

## 4. 常用操作

### SSH 連線

```bash
ssh test@100.116.108.68
# 密碼：見內部密碼管理（文件不記錄）
```

### 服務管理

```bash
# 重啟 Ollama（改 override 後必做）
sudo systemctl daemon-reload
sudo systemctl restart ollama

# 狀態
sudo systemctl status ollama
sudo journalctl -u ollama -f
```

### 驗證 GPU 有吃到

```bash
sudo journalctl -u ollama -n 30 | grep "inference compute"
# 預期：library=CUDA  compute=12.1  name=CUDA0  description="NVIDIA GB10"  libdirs=ollama,cuda_v13

sudo -u ollama ollama ps
# 預期：gemma4:26b  …  100% GPU  …  Forever
```

### API 測試

```bash
# 本機
curl http://127.0.0.1:11434/api/version
curl http://127.0.0.1:11434/api/tags

# Tailscale（任意 Client）
curl http://100.116.108.68:11434/api/chat -d '{
  "model": "gemma4:26b",
  "messages": [{"role": "user", "content": "你好"}],
  "stream": false
}'
```

### 拉取 / 更新模型

```bash
sudo -u ollama ollama pull gemma4:26b
sudo -u ollama ollama list
```

### UMA 記憶體壓力（切模型 / OOM 時）

GB10 統一記憶體下，Linux page cache 可能與 GPU 搶記憶體：

```bash
sudo sync; sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
sudo systemctl restart ollama
```

---

## 5. Client 連線設定（NeuroSme 等）

此機**只跑 Ollama**，NeuroSme 部署在其他 host 時，後台 LLM 設定：

| 欄位 | 值 |
|------|-----|
| Provider | Local / 本機 |
| API Base URL | `http://100.116.108.68:11434` |
| Chat Model | `local/gemma4:26b` |
| API Key | 任意字串 |

> NeuroSme **與 Ollama 同機且 NeuroSme 在 Docker 內**時，Base URL 改填 `http://host.docker.internal:11434`（此 GB10 目前未裝 NeuroSme，用 Tailscale IP 即可）。

---

## 6. 故障排除

| 症狀 | 可能原因 | 處理 |
|------|----------|------|
| `library=CUDA` 未出現，或跑 CPU | 缺少 `OLLAMA_LLM_LIBRARY=cuda_v13` | 確認 override.conf，重啟 ollama |
| `cc=1210` + `cuda_v12` skipped | 正常；v12 不支援 SM121 | 必須用 `cuda_v13` |
| `:11434` 連線被拒 | ollama 未起或 port 被 nginx 佔用 | `ss -tln \| grep 11434`；移除 `ollama-lb.conf` |
| `model not found` | 未 pull | `sudo -u ollama ollama pull gemma4:26b` |
| 回應為空 | gemma4 thinking 模型 | 檢查 API 回應的 `thinking` 欄位 |
| OOM / 載入失敗 | UMA 記憶體不足 | drop_caches、降 `NUM_PARALLEL`、確認只有單一實例 |
| 誤設 `OLLAMA_VULKAN` / `radeon_icd` | 從 AMD 機複製設定 | 刪除，僅保留 CUDA 設定 |

---

## 7. 伺服器上的部署腳本

| 路徑 | 說明 |
|------|------|
| `scripts/deploy_ollama_gb10.sh` | **GB10 正確設定**（單實例 + cuda_v13）；gx10 上亦可從 repo 複製執行 |
| `~/下載/deploy_ollama.sh` | ⚠️ 舊版 AMD 三實例腳本，**勿再使用** |

重新部署（會覆寫 override 並 pull gemma4:26b）：

```bash
bash scripts/deploy_ollama_gb10.sh
```

---

## 8. 參考資料

- [NVIDIA DGX Spark Ollama Playbook](https://github.com/NVIDIA/dgx-spark-playbooks/blob/main/nvidia/ollama/README.md)
- [NVIDIA Forums — GB10 LLM Stack](https://forums.developer.nvidia.com/t/running-a-full-llm-stack-on-dgx-spark-gb10-your-application-litellm-llama-swap-vllm-llama-cpp-ollama/367580)
- [NVIDIA txt2kg — Ollama on DGX Spark troubleshooting](https://build.nvidia.com/spark/txt2kg/troubleshooting)
- 站內 AMD 架構：[`ollama-server-setup-guide.md`](./ollama-server-setup-guide.md)

---

## 9. 變更紀錄

| 日期 | 變更 |
|------|------|
| 2026-06-30 | 初版：自 AMD 三實例改為 GB10 單實例；移除 Vulkan/radeon 設定；部署 `gemma4:26b`；新增 `deploy_ollama_gb10.sh` |
| 2026-06-30 | 新增 `NUM_PARALLEL` 調校說明 |
| 2026-06-30 | 實測後將 `NUM_PARALLEL` 由 2 調整為 3 |

<!-- 後續修改請在此表新增一列，並更新文首「最後更新」日期 -->
