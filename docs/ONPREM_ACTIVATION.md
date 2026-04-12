# NeuroSme On-Prem 首次啟用作業說明

本文件說明 NeuroSme on-prem 版本的完整啟用流程，分為「REAS 內部作業」與「客戶端作業」兩部分。

---

## 流程總覽

```
REAS 業務／工程師                    客戶
      │                               │
      ├─ 1. 確認採購清單              │
      ├─ 2. 產生 Activation Code ──→  收到 Code（email）
      ├─ 3. 交付安裝包           ──→  下載安裝包
      │                               ├─ 4. 安裝系統
      │                               ├─ 5. 首次登入
      │                               ├─ 6. 貼入 Code → 系統啟用
      │                               └─ 7. 建立使用者、設定權限
```

---

## Part 1：REAS 內部作業

### Step 1：確認採購清單

確認客戶購買的 agent 模組，對應 `agent_catalog` 的 `agent_id`：

- `order` — Order Agent
- `quotation` — Quotation Agent
- `business` — Business Insight Agent
- `customer` — Customer Insight Agent
- `test01` — Test01 Agent
- `interview` — Interview Agent
- `scheduling` — Scheduling Agent
- `workorder` — Work Order Agent
- `invoice` — Invoice Agent
- `chat` — Chat Agent

---

### Step 2：產生 Activation Code

1. 以 **`super_admin`** 帳號登入 NeuroSme
2. 進入「管理工具」→「**REAS-Activate Code**」
3. 填入：
   - **客戶名稱**：例如「ACME 科技股份有限公司」
   - **授權 Agents**：勾選客戶購買的模組
   - **到期日**：依合約填寫（年約填一年後；永久授權留空）
4. 點擊「產生 Activation Code」
5. 點擊「複製」，將 Code 傳送給客戶（email 或業務通訊）

> **注意**：Code 是一次性產生的字串，請妥善保存或截圖備查。  
> 若客戶 Code 遺失，可重新產生新 Code（舊 Code 仍有效，不會自動失效）。

---

### Step 3：交付安裝包

提供客戶以下檔案：

- `neurosme-1.x.x.tar`（NeuroSme 主系統 image）
- `localauth-1.x.x.tar`（認證服務 image）
- `docker-compose.onprem.yml`（啟動設定，所有客戶同一份）

---

## Part 2：客戶端作業

### Step 4：安裝系統（一次性）

**載入 image：**
```bash
docker load -i neurosme-1.x.x.tar
docker load -i localauth-1.x.x.tar
```

**啟動：**
```bash
docker compose -f docker-compose.onprem.yml up -d
```

確認服務正常運行：
```bash
docker compose -f docker-compose.onprem.yml ps
```

所有服務應顯示 `Up`。

---

### Step 5：首次登入

開啟瀏覽器進入系統（網址由 IT 確認，通常為 `http://伺服器IP`）。

預設 admin 帳號：
- **Email**：`admin@local.dev`
- **密碼**：`Admin1234!`

> **重要**：登入後請立即至「帳號設定」修改預設密碼。

---

### Step 6：輸入 Activation Code（系統啟用）

登入後系統會自動彈出啟用對話框：

```
┌─────────────────────────────────────┐
│  🔑 系統啟用                         │
│                                     │
│  請輸入您的 Activation Code         │
│  以啟用已購買的功能模組。            │
│                                     │
│  [ 貼入 Code...                   ] │
│                                     │
│  [  啟用系統  ]                     │
└─────────────────────────────────────┘
```

1. 將 REAS 提供的 Activation Code 貼入欄位
2. 點擊「啟用系統」
3. 出現「系統已啟用」提示後，頁面自動重新整理
4. 已購買的助理模組即會出現在首頁

> 若啟用失敗，請確認 Code 是否完整複製（包含 `.` 分隔符號）。

---

### Step 7：建立使用者與設定 Agent 權限

**建立使用者：**

1. 進入「管理工具」→「會員管理」
2. 點擊「新增使用者」，填入 email、姓名、初始密碼
3. 系統會自動建立帳號

**設定 Agent 權限：**

1. 進入「管理工具」→「Agent 權限設定」
2. 左側選擇使用者
3. 右側勾選該使用者可存取的 agent 模組
4. 設定角色（`member` / `manager` / `admin`）
5. 點擊「儲存」

角色說明：
- `member`：一般使用者，只能使用被授權的 agents
- `manager`：進階使用者（依系統設定）
- `admin`：可管理使用者與權限設定

---

## Part 3：加購 Agent 模組

當客戶加購新模組時：

1. **REAS 端**：重新產生含新模組的 Activation Code 傳給客戶
2. **客戶端**：進入「管理工具」→「Agent 權限設定」，點擊頁面右上角的「重新啟用」輸入新 Code

> 重新啟用後，新模組會立即出現，原有設定不受影響。

---

## Part 4：常見問題

**登入後沒有出現啟用對話框**
確認登入帳號為 `admin` 角色（`super_admin` 不顯示此對話框）。

**輸入 Code 後顯示「Code 無效或已被竄改」**
Code 複製不完整，請重新完整複製後再試（包含 `.` 分隔符號）。

**輸入 Code 後顯示「Code 已到期」**
聯繫 REAS 重新產生新的 Activation Code。

**啟用後 Agent 沒有出現**
確認已在「Agent 權限設定」將 agent 授權給使用者。

**忘記預設密碼**
預設密碼為 `Admin1234!`；若已修改且遺忘，聯繫 REAS 協助重設。

---

## 附錄：角色與權限說明

**member**
- 使用被授權的 agents

**manager**
- 使用被授權的 agents（進階功能依系統設定）

**admin**
- 使用被授權的 agents
- 管理使用者帳號
- 設定使用者的 Agent 權限
- 輸入 Activation Code 啟用系統

**super_admin**（REAS 內部使用）
- 所有 admin 功能
- 管理 Tenants 與 Agent Catalog
- 產生 Activation Code
- 不顯示啟用對話框（bypass）
