# KM 知識庫三件套 代管服務架構規劃

> 狀態：草稿討論中  
> 最後更新：2026-05-16

---

## 背景與問題

NeuroSme 的 **Doc Refiner + KB Manager + KB Bot Builder（知識庫三件套）** 對小型企業客服 chatbot 場景需求強烈，但客戶無法負擔：

1. 完整的 NeuroSme Private Hub 授權費用
2. 自行管理一台伺服器的人力與技術成本

**目標**：由 REAS 自行 host 一套共用基礎設施，讓多個小型企業客戶使用知識庫三件套，但不走標準 SaaS（無公開自助開通、無 public billing portal），定位為 **ISV 代管服務（Managed Hosting）**。

---

## 選定架構：Per-Tenant 獨立 Stack + 共用主機

### 核心概念

每個客戶 = 一套獨立的 Docker Compose Stack，部署在同一台 production 主機上，由前端統一 reverse proxy（Caddy）按 subdomain 路由。

```
Production 主機
├── Caddy（port 80/443，按 subdomain 分流）
│
├── acme.km.[domain]
│     ├── frontend（static）
│     ├── backend（Python/uvicorn）
│     ├── neurosme-db（PostgreSQL）
│     └── localauth-db（PostgreSQL）
│
├── betacorp.km.[domain]
│     └── （同上結構）
│
└── gamma.km.[domain]
      └── （同上結構）
```

### 為何選此架構

- **現有 codebase 幾乎不需要改動**：直接重用 `docker-compose.onprem.yml`
- **強資料隔離**：每租戶獨立 postgres volume，互不影響
- **故障隔離**：一個租戶問題不波及其他人
- **不需要 Kubernetes**：Docker Compose + 腳本即可管理

### 捨棄的方案

| 方案 | 捨棄原因 |
|------|---------|
| 真多租戶（DB 共用 + tenant_id） | 需大幅改造 backend/LocalAuth，安全風險高，初期客戶數不值得 |
| 標準 SaaS | 需要 self-serve portal、billing 系統，工程成本過高 |

---

## 資源估算（基於 Demo 環境實測）

### 每個租戶的記憶體用量（實測值）

| 服務 | 實測 RSS |
|------|---------|
| backend（Python/uvicorn） | ~300 MB |
| neurosme-db（PostgreSQL） | ~75 MB |
| localauth（NestJS） | ~47 MB |
| localauth-db（PostgreSQL） | ~24 MB |
| frontend（static container） | ~6 MB |
| **每租戶合計** | **≈ 452 MB** |

### Production 主機建議規格

| 規格 | 推薦 | 備註 |
|------|------|------|
| RAM | 16 GB | 舒適跑 12–15 租戶 |
| CPU | 4 vCPU | 小企業用量多為 idle，不是瓶頸 |
| 系統磁碟 | 50 GB | OS + Docker images |
| 資料磁碟 | 另掛 300 GB+ | 所有租戶資料獨立掛載 |

### 租戶容量估算（16GB RAM 主機）

- 保守（每租戶預留 700MB 含 DB 成長）：**≈ 17 個租戶**
- 舒適建議上限：**12–15 個租戶**

---

## 資料磁碟規劃

租戶資料應掛載到獨立磁碟（非系統碟），統一放在 `/data/tenants/`：

```
/data/tenants/
├── acme/
│     ├── postgres/        ← neurosme-db volume
│     ├── localauth/       ← localauth-db volume
│     ├── stored_files/    ← 上傳的文件
│     └── duckdb/          ← DuckDB 檔案
├── betacorp/
│     └── ...
└── gamma/
      └── ...
```

---

## LLM 設定

- LLM API Key 由系統管理員（REAS）在每個租戶的 NeuroSme 管理後台設定，儲存於該租戶的 DB 中（加密）
- LLM 廠商與模型由 REAS 決定（初期預計使用 OpenAI）
- 費用模型（待決定）：
  - 選項 A：共用同一把 API Key，費用內含在月費中
  - 選項 B：每租戶使用自己的 API Key，費用自付

---

## 服務定位

| 項目 | 說明 |
|------|------|
| 名稱方向 | 客服知識庫代管方案 / KM Bot 訂閱服務 |
| 開通方式 | 合約制，REAS 手動開通（非 self-serve） |
| 維護 | REAS 負責主機、軟體更新、備份 |
| 客戶責任 | 整理知識庫內容、使用產品功能 |
| 白牌可能性 | 可以，subdomain 可設為客戶自有網域 |

---

## Domain 規劃

### 命名規則

租戶 subdomain 格式：`{tenant-slug}.km.neurosme.com`

### 單台 VM

DNS 設定一條 wildcard A record，所有租戶自動解析，無需每次改 DNS：

```
*.km.neurosme.com  →  VM1 IP
```

### 擴充到第二台 VM

利用「具體 A record 優先於 wildcard」的 DNS 特性：

```
*.km.neurosme.com     →  VM1（舊租戶繼續生效）
compD.km.neurosme.com →  VM2（新租戶加具體 record）
compE.km.neurosme.com →  VM2
```

不需要 load balancer，舊租戶零感知。

### 遷移租戶到另一台 VM

將該租戶從 wildcard 改為具體 A record 指向新 VM 即可。

### 白牌（客戶自有網域）

客戶在自己 DNS 加 CNAME：

```
chatbot.acmecorp.com  →  CNAME  →  compA.km.neurosme.com
```

Caddy 自動為自定義網域申請 Let's Encrypt 憑證。

---

## 待討論事項

- [ ] Production 主機選擇：新開 GCP VM 或其他雲？規格確認
- [ ] 備份策略：各租戶 postgres volume 備份頻率與方式
- [ ] 開通流程：`provision-tenant.sh` 腳本設計
- [ ] 升級策略：升版時如何逐一更新各租戶 stack
- [ ] 監控：如何監控各租戶服務健康狀態
- [ ] 定價：月費結構（含 LLM 費用攤算）
- [ ] 功能範圍：**暫定與 on-prem 版本保持一致（不做精簡）**。未來若租戶數超過 10 個，可考慮在 `backend/app/api/__init__.py` 加 `FEATURE_BI_ENABLED` 環境變數 feature flag，讓 KM-only 租戶不載入 BI 模組（`bi_projects`、`chat_compute_tool`、`duckdb`、`pandas` 等），預估可節省 150–200 MB RAM / 租戶，單機容量從 12–15 增加到 20–25 個租戶。
