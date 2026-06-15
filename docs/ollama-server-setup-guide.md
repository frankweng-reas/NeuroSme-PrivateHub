# Ollama 三實例 + Nginx 負載均衡 — 部署指南

> 適用於在 **AMD GPU（Vulkan）** 主機上部署 Ollama，供 NeuroSme 或其他服務透過單一入口 `:11434` 連線。  
> 參考機：`test@100.127.247.43`（Tailscale IP，主機名 `test-STHT1`）  
> 詳細 GPU 除錯紀錄見 [`ollama-amd-gfx1151-gpu-fix.md`](./ollama-amd-gfx1151-gpu-fix.md)

---

## 1. 架構概覽

```
外部請求（NeuroSme / curl / API）
        │
        ▼
  nginx :11434          ← 唯一對外 port（least_conn 負載均衡）
        │
        ├── ollama  :11435   NUM_PARALLEL=1
        ├── ollama2 :11436   NUM_PARALLEL=1
        └── ollama3 :11437   NUM_PARALLEL=1
```

| 項目 | 說明 |
| --- | --- |
| 對外入口 | http://{主機IP}:11434 |
| 後端實例 | 只監聽 127.0.0.1:11435～11437，不直接對外 |
| 並發能力 | 3 個請求可同時處理（各佔一個實例） |
| 主模型 | gemma4:26b（每實例約 25 GB VRAM） |
| Embedding | nomic-embed-text:latest（由 nginx 自動分流） |

**為什麼要三實例？**  
Ollama 在 `NUM_PARALLEL > 1` 時，vision 請求與 Vulkan backend 併發可能死鎖。每實例設 `NUM_PARALLEL=1` 可保穩定，再用 nginx 分流達到 3 路並發。

**VRAM 規劃（96 GB 等級 GPU）**

| 實例數 | 用量 | 剩餘 |
| --- | --- | --- |
| 3 個（建議） | 約 71 GB | 約 25 GB |
| 4 個 | 約 96 GB | 不建議（無緩衝） |

---

## 2. 硬體與軟體需求

### 硬體

- AMD GPU，VRAM ≥ 96 GB（三實例各載入 `gemma4:26b`）
- 系統 RAM ≥ 32 GB 建議
- 開放 **TCP 11434**（Tailscale / 內網防火牆）

### 軟體

```bash
# Ubuntu 24.04 為例
sudo apt update
sudo apt install -y nginx curl python3 mesa-vulkan-drivers libvulkan1 rocm

# 安裝 Ollama（官方 script，目前使用 0.21.x）
curl -fsSL https://ollama.com/install.sh | sh
```

確認 GPU 可用：

```bash
ollama --version
rocm-smi          # 或 vulkaninfo | grep deviceName
```

---

## 3. 拉取模型

三個實例共用同一份 model store（`/usr/share/ollama/.ollama/models`），只需 pull 一次：

```bash
sudo -u ollama ollama pull gemma4:26b
sudo -u ollama ollama pull nomic-embed-text
```

> **注意**：`gemma4:e4b` 在 AMD Vulkan（gfx1151）環境已知有問題（CPU/GPU 混跑、輸出異常），**正式環境請用 `gemma4:26b`**。詳見 GPU 除錯文件。

---

## 4. systemd 服務設定

### 4.1 主服務 ollama（instance 1，port 11435）

`/etc/systemd/system/ollama.service`（Ollama 安裝時通常已存在，確認內容類似）：

```ini
[Unit]
Description=Ollama Service
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"

[Install]
WantedBy=default.target
```

建立 override：

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11435"
Environment="OLLAMA_ORIGINS=*"
Environment="OLLAMA_VULKAN=1"
Environment="VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_NUM_PARALLEL=1"
EOF
```

### 4.2 ollama2 / ollama3

```bash
# ollama2.service
sudo tee /etc/systemd/system/ollama2.service <<'EOF'
[Unit]
Description=Ollama Service (Instance 2)
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"

[Install]
WantedBy=default.target
EOF

sudo mkdir -p /etc/systemd/system/ollama2.service.d
sudo tee /etc/systemd/system/ollama2.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11436"
Environment="OLLAMA_ORIGINS=*"
Environment="OLLAMA_VULKAN=1"
Environment="VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_NUM_PARALLEL=1"
EOF

# ollama3.service（結構相同，port 改 11437）
sudo tee /etc/systemd/system/ollama3.service <<'EOF'
[Unit]
Description=Ollama Service (Instance 3)
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"

[Install]
WantedBy=default.target
EOF

sudo mkdir -p /etc/systemd/system/ollama3.service.d
sudo tee /etc/systemd/system/ollama3.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11437"
Environment="OLLAMA_ORIGINS=*"
Environment="OLLAMA_VULKAN=1"
Environment="VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_NUM_PARALLEL=1"
EOF
```

### 環境變數說明

| 變數 | 值 | 用途 |
| --- | --- | --- |
| OLLAMA_HOST | 127.0.0.1:1143x | 各實例獨立 port，不可設 0.0.0.0 |
| OLLAMA_VULKAN | 1 | AMD GPU 走 Vulkan（ROCm 在此硬體有 bug） |
| VK_ICD_FILENAMES | .../radeon_icd.json | 指定 Radeon Vulkan driver |
| OLLAMA_FLASH_ATTENTION | 1 | 啟用 Flash Attention（此硬體必要） |
| OLLAMA_KEEP_ALIVE | -1 | 模型常駐 VRAM，不重複載入 |
| OLLAMA_NUM_PARALLEL | 1 | 每實例一次只處理一個請求（vision 穩定） |

> **NVIDIA GPU 環境**：移除 `OLLAMA_VULKAN` / `VK_ICD_FILENAMES`，改用 CUDA 預設即可；三實例 + nginx 架構仍適用。

---

## 5. Nginx 負載均衡

```bash
sudo tee /etc/nginx/conf.d/ollama-lb.conf <<'EOF'
upstream ollama_pool {
    least_conn;
    server 127.0.0.1:11435;
    server 127.0.0.1:11436;
    server 127.0.0.1:11437;
}

server {
    listen 11434 default_server;
    listen [::]:11434 default_server;

    client_max_body_size 50M;
    proxy_read_timeout    300s;
    proxy_connect_timeout  10s;
    proxy_send_timeout    300s;

    location / {
        proxy_pass         http://ollama_pool;
        proxy_http_version 1.1;
        proxy_set_header   Host              "localhost";
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   Connection        "";
        proxy_buffering    off;
    }
}
EOF

sudo nginx -t
```

**重要**：Ollama v0.21.x 會驗證 `Host` header，nginx **必須**送 `Host: localhost`，否則後端回 `403 Forbidden`。

**port 分工（不可搞混）**

| Port | 用途 | 誰監聽 |
| --- | --- | --- |
| 11434 | 對外 API 入口 | nginx |
| 11435 | instance 1 | ollama |
| 11436 | instance 2 | ollama2 |
| 11437 | instance 3 | ollama3 |

> ⚠️ **請勿**把 `ollama` 的 `OLLAMA_HOST` 改成 `0.0.0.0` 或佔用 11434，否則 nginx 無法啟動，整個 LB 失效。

---

## 6. 開機暖機（可選但建議）

重開機後模型需重新載入 VRAM（約 8 秒/實例）。建議用暖機腳本預載。

腳本來源：本 repo 的 [`scripts/ollama_vision_warmup.py`](../scripts/ollama_vision_warmup.py)

```bash
sudo cp scripts/ollama_vision_warmup.py /usr/local/bin/
sudo chmod +x /usr/local/bin/ollama_vision_warmup.py

sudo tee /etc/systemd/system/ollama-warmup.service <<'EOF'
[Unit]
Description=Ollama Vision Warmup (preload model on boot)
After=ollama.service ollama2.service ollama3.service network-online.target
Requires=ollama.service ollama2.service ollama3.service

[Service]
Type=oneshot
User=YOUR_LINUX_USER
ExecStartPre=/bin/sleep 10
ExecStart=/usr/bin/python3 /usr/local/bin/ollama_vision_warmup.py 127.0.0.1
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
```

將 `YOUR_LINUX_USER` 改為可執行 curl 的帳號（參考機為 test）。

---

## 7. 啟動順序

```bash
sudo systemctl daemon-reload

# 先啟後端三實例
sudo systemctl enable --now ollama ollama2 ollama3

# 再啟 nginx（佔 11434）
sudo systemctl enable --now nginx

# 暖機
sudo systemctl enable --now ollama-warmup
# 或手動：python3 /usr/local/bin/ollama_vision_warmup.py 127.0.0.1
```

---

## 8. 驗證

```bash
# 四個 port 都應回 200
for p in 11434 11435 11436 11437; do
  echo -n "port $p: "
  curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$p/api/version
  echo
done

# 確認 GPU 有在跑
OLLAMA_HOST=127.0.0.1:11435 ollama ps
OLLAMA_HOST=127.0.0.1:11436 ollama ps
OLLAMA_HOST=127.0.0.1:11437 ollama ps
# PROCESSOR 應顯示 100% GPU

# 從外部機器測試 LB
curl http://YOUR_HOST_IP:11434/api/version
curl http://YOUR_HOST_IP:11434/api/generate \
  -d '{"model":"gemma4:26b","prompt":"hi","stream":false,"options":{"num_predict":3}}'
```

便利腳本（參考機 `~/ollama.sh`）：

```bash
OLLAMA_HOST=127.0.0.1:11435 ollama ps
OLLAMA_HOST=127.0.0.1:11436 ollama ps
OLLAMA_HOST=127.0.0.1:11437 ollama ps
```

---

## 9. NeuroSme 連線設定

在 NeuroSme 後台 **LLM Provider 設定**：

| 欄位 | 值 |
| --- | --- |
| Provider | Local / 本機 |
| API Base URL | http://{Ollama主機IP}:11434 |
| Chat Model ID | local/gemma4:26b |
| Embedding Model ID | local/nomic-embed-text:latest |
| API Key | 任意字串（本機 Ollama 不驗證） |

> NeuroSme 走 Ollama 原生 `/api/chat`（`local/` 前綴），支援 `think` 參數。  
> Docker 內的 NeuroSme 若 Ollama 在宿主機，Base URL 改填 `http://host.docker.internal:11434`。

---

## 10. 日常維運

```bash
# 查看三實例狀態
systemctl status ollama ollama2 ollama3 nginx

# 重啟（順序：先 ollama 後 nginx）
sudo systemctl restart ollama ollama2 ollama3
sudo systemctl restart nginx
python3 /usr/local/bin/ollama_vision_warmup.py 127.0.0.1

# 拉新模型
sudo -u ollama ollama pull MODEL_NAME

# 查看 nginx 錯誤
sudo tail -f /var/log/nginx/error.log
```

### 常見錯誤

| 現象 | 原因 | 解法 |
| --- | --- | --- |
| bind: address already in use（11434） | ollama 搶佔 11434 | 還原 OLLAMA_HOST=127.0.0.1:11435，重啟 ollama，再啟 nginx |
| 外部連 11434 空回應 | nginx worker crash | ollama-lb.conf 不要用 access_by_lua_block（Lua segfault） |
| 403 Forbidden | Host header 不對 | nginx 必須設 proxy_set_header Host localhost |
| 100% CPU | Vulkan 未生效 | override 需有 OLLAMA_VULKAN=1 和 VK_ICD_FILENAMES |
| vision 請求 hang | NUM_PARALLEL 大於 1 | 維持每實例 OLLAMA_NUM_PARALLEL=1 |

---

## 11. 檔案清單（複製部署檢查表）

| 路徑 | 說明 |
| --- | --- |
| /etc/systemd/system/ollama.service.d/override.conf | instance 1，port 11435 |
| /etc/systemd/system/ollama2.service | instance 2 unit |
| /etc/systemd/system/ollama2.service.d/override.conf | port 11436 |
| /etc/systemd/system/ollama3.service | instance 3 unit |
| /etc/systemd/system/ollama3.service.d/override.conf | port 11437 |
| /etc/nginx/conf.d/ollama-lb.conf | LB 設定 |
| /usr/local/bin/ollama_vision_warmup.py | 暖機腳本 |
| /etc/systemd/system/ollama-warmup.service | 開機暖機 |

Repo 相關文件：

- [`docs/ollama-amd-gfx1151-gpu-fix.md`](./ollama-amd-gfx1151-gpu-fix.md) — GPU 除錯、壓測、已知問題
- [`scripts/ollama_vision_warmup.py`](../scripts/ollama_vision_warmup.py) — 暖機腳本
- [`scripts/benchmark_ollama_parallel.py`](../scripts/benchmark_ollama_parallel.py) — 並發壓測

---

## 12. 快速部署一鍵腳本（進階）

若新機環境與參考機相同（Ubuntu + AMD Vulkan + 96GB VRAM），可依序執行第 3～7 節的指令。  
建議先在測試機跑完第 8 節驗證，再切換 NeuroSme 的 API Base URL。
