# NeuroSme On-Prem Online 安裝說明

適用於伺服器**可連外網**的客戶。客戶無需下載大型安裝包，一行指令完成安裝。

---

## 前置條件

| 項目 | 要求 |
|---|---|
| Docker | 已安裝（`curl -fsSL https://get.docker.com | sh`）|
| Docker Compose Plugin | 已安裝（Docker 26+ 內建）|
| Port 80 / 443 | 防火牆已開放 inbound |
| 網路 | 可連到 `portal.ee.neurosme.ai`（REAS Portal）|
| Activation Code | 由 REAS 業務提供 |

---

## 客戶安裝指令

```bash
curl -fsSL https://portal.ee.neurosme.ai/install.sh | ACTIVATION_CODE="<你的授權碼>" bash
```

腳本會自動完成：
1. 驗證授權碼
2. 詢問伺服器 domain 或 IP，自動設定 HTTPS
3. 從 REAS Portal 下載 Docker images（tar.gz）
4. 載入 images 並啟動所有服務

安裝完成後，依提示開啟瀏覽器，用預設帳號 `admin@local.dev` / `Admin1234!` 登入，並輸入 Activation Code 啟用模組。

> **IP 選擇提示**：腳本會列出本機所有 IP，請輸入**使用者實際連線用的 IP 或 domain**。

---

## REAS 內部：發行 Online 版前的準備

### 1. Build Images 並部署至 Portal

```bash
bash ~/scripts/build-onprem.sh
```

腳本會：
- Build 4 個自建 images（postgres、backend、frontend、localauth）
- 將 image tar.gz 複製至 `~/release/images/`（portal 提供下載的來源）
- 同時產出 offline 交付包 `~/release/neurosme-onprem-<版本>.tar.gz`

| Image | 自建原因 |
|---|---|
| neurosme2-postgres | 基底為 `pgvector/pgvector:pg16`，額外打包 **pg_cjk_parser**（繁體中文全文搜尋） |
| neurosme-backend | 包含 NeuroSme 後端程式碼與 Python 依賴 |
| neurosme-frontend | 包含前端靜態 build 產物（Vite + React） |
| localauth | 包含 LocalAuth 身份驗證服務（Node.js） |

> **Docker Hub 公開 image（客戶端直接 pull）：**
> - `caddy:2-alpine` — Reverse proxy / HTTPS
> - `postgres:16` — localauth 專用資料庫

### 2. 確認 Portal 下載 API 可用

portal 提供的下載端點（`reas-portal/backend/app/api/download.py`）會直接從 `~/release/images/` 目錄提供 image 下載。Build 完成後無需額外操作。

---

## 升版

重新執行相同指令即可。腳本會自動沿用已設定的 domain/IP，下載最新 image 並重啟。資料目錄 `~/neurosme-data/` 不受影響。

## 日常重啟

```bash
bash ~/neurosme/restart.sh
```

## 換網路環境（搬遷展場、更換 IP）

若機器搬到新環境導致 IP 或 domain 改變：

```bash
bash ~/neurosme/restart.sh --reconfigure
```

腳本會列出目前機器偵測到的 IP，重新詢問並更新設定後再重啟。

---

## 與 Offline 安裝包的比較

| | Online 安裝 | Offline 安裝包 |
|---|---|---|
| 客戶需要網路 | ✅ 是（連 portal.ee.neurosme.ai）| ❌ 否 |
| 安裝包大小 | ~5 KB（腳本）| ~750 MB |
| 安裝指令 | `curl \| bash` | `bash start.sh` |
| 升版方式 | 重跑指令 | 解壓新包執行 `bash start.sh` |

---

## 相關文件

- [ONPREM_ACTIVATION.md](./ONPREM_ACTIVATION.md) — Activation Code 發放與啟用流程
- [ONPREM_HTTPS.md](./ONPREM_HTTPS.md) — HTTPS / 自備憑證設定
