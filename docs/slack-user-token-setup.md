# Slack User Token 取得指南

> 適用情境：需要以使用者身份存取 Slack workspace 資料（頻道訊息、DM、搜尋等）

---

## Token 類型說明

| 類型 | 前綴 | 身份 | 適用情境 |
|------|------|------|---------|
| Bot Token | `xoxb-` | App Bot | 發送訊息、監聽事件 |
| **User Token** | `xoxp-` | 使用者本人 | 讀取私有頻道、DM、搜尋訊息 |

---

## 取得步驟

### 1. 建立 Slack App

前往 [api.slack.com/apps](https://api.slack.com/apps)

**Create New App** → **From Scratch** → 輸入 App 名稱並選擇目標 Workspace

---

### 2. 設定 User Token Scopes

進入 App → 左側選單 **OAuth & Permissions** → 往下捲至 **Scopes** 區塊

> ⚠️ 注意：選 **User Token Scopes**，不是 Bot Token Scopes

依需求勾選以下權限：

| Scope | 說明 |
|-------|------|
| `channels:read` | 讀取公開頻道列表 |
| `channels:history` | 讀取公開頻道訊息紀錄 |
| `groups:read` | 讀取私有頻道列表 |
| `groups:history` | 讀取私有頻道訊息紀錄 |
| `im:read` | 讀取 DM 列表 |
| `im:history` | 讀取 DM 訊息紀錄 |
| `mpim:history` | 讀取群組 DM 訊息紀錄 |
| `users:read` | 讀取使用者基本資訊 |
| `search:read` | 搜尋訊息與檔案 |
| `files:read` | 讀取檔案內容 |

---

### 3. 安裝 App 到 Workspace

**OAuth & Permissions** 頁面頂部 → **Install to Workspace** → 點選授權

---

### 4. 複製 User Token

安裝完成後，同一頁面的 **OAuth Tokens for Your Workspace** 區塊會出現：

```
User OAuth Token
xoxp-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

複製並妥善保存。

---

## 注意事項

- User Token 代表**授權者個人帳號**操作，請勿提交至 Git
- 存取**私有頻道**需要 `groups:read` + `groups:history`，且授權使用者必須是該頻道成員
- Token 不會自動過期，但撤銷 App 或移除安裝後即失效
- Production 環境建議使用完整 **OAuth 2.0 Authorization Code Flow**，而非個人 token

---

## 快速驗證

取得 token 後，可用以下指令測試連線是否正常：

```bash
curl -H "Authorization: Bearer xoxp-你的token" \
  https://slack.com/api/auth.test
```

回傳 `"ok": true` 表示 token 有效。
