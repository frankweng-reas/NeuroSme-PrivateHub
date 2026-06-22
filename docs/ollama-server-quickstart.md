# Ollama Server 快速設定指南

> 完整架構說明與進階設定請見 [`ollama-server-setup-guide.md`](./ollama-server-setup-guide.md)

---

## 前置條件

- Ubuntu 24.04
- AMD GPU（Vulkan）或 NVIDIA GPU（CUDA），VRAM ≥ 24 GB
- 已安裝 Docker

---

## Step 1：安裝 Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

---

## Step 2：拉取 LLM 與 Embedding 模型

```bash
# 主要 LLM（chat / doc refiner / KB）
sudo -u ollama ollama pull gemma4:26b

# Embedding（知識庫向量搜尋）
sudo -u ollama ollama pull nomic-embed-text
```

| 模型 | 用途 | 大小 |
|---|---|---|
| `gemma4:26b` | Chat、Doc Refiner、KB 問答 | ~17 GB |
| `nomic-embed-text` | 知識庫向量 Embedding | ~274 MB |

> **AMD GPU 注意**：請勿使用 `gemma4:e4b`，在 AMD Vulkan 環境有已知問題，請固定使用 `gemma4:26b`。

---

## Step 3：啟動 STT 服務（faster-whisper）

```bash
docker run -d --restart unless-stopped \
  --name faster-whisper \
  -p 8002:8000 \
  -e WHISPER__MODEL=medium \
  -e WHISPER__INFERENCE_DEVICE=cpu \
  fedirz/faster-whisper-server:latest-cpu
```

| 項目 | 值 |
|---|---|
| 模型 | `medium`（可改 `large-v3` 提升精度，但較慢）|
| 裝置 | `cpu`（若有 NVIDIA GPU 可改用 GPU 版 image）|
| 對外 Port | `8002` |

---

## Step 4：確認服務正常

```bash
# Ollama（LLM + Embedding）
curl http://localhost:11434/api/version

# STT
curl http://localhost:8002/health
```

---

## Step 5：NeuroSme 後台設定

登入 NeuroSme 管理後台 → **LLM Provider 設定**，填入以下資訊：

| 欄位 | 值 |
|---|---|
| Provider | Local / 本機 |
| API Base URL | `http://{此機器IP}:11434` |
| Chat Model | `local/gemma4:26b` |
| Embedding Model | `local/nomic-embed-text:latest` |
| API Key | 任意字串 |
| STT API Base URL | `http://{此機器IP}:8002` |
| STT Model | `Systran/faster-whisper-medium` |

> **NeuroSme 跑在 Docker 且 Ollama/STT 在同一台宿主機時**，Base URL 改用：
> - `http://host.docker.internal:11434`
> - `http://host.docker.internal:8002`

---

## 多實例 + 負載均衡（選配，提升並發）

若需同時服務多個使用者，建議部署三個 Ollama 實例 + Nginx 負載均衡，詳見 [`ollama-server-setup-guide.md`](./ollama-server-setup-guide.md)。
