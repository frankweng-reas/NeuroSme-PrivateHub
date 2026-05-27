# 平台管理（Admin Settings）操作指南

> 本頁說明管理員可使用的後台功能。進入方式：右上角頭像 → **管理設定**（需 `admin` 以上角色）。

---

## 一、角色與權限層級

系統採三層角色設計：

| 角色 | 說明 |
|------|------|
| `admin` | 公司 IT 管理員，可管理使用者、權限、LLM、Widget、知識庫 |
| `manager` | 部門主管，可建立「公司共用」知識庫，供 KB Bot Builder 引用 |
| `member` | 一般員工，使用已開放的 Agent 與模型 |

> **注意**：每個公司至少保留一位 `admin`，無法將唯一的 admin 降級。

---

## 二、使用者管理

**位置**：管理設定 → 使用者管理

### 新增使用者
1. 點擊右上角 **＋ 新增**。
2. 填入姓名、Email、初始密碼，選擇角色。
3. 點擊 **確認**，帳號立即生效。

### 修改 / 刪除使用者
- 點擊列表右側 ✏️ 編輯姓名、Email、角色與密碼。
- 點擊 🗑️ 刪除帳號（操作不可復原）。

---

## 三、使用者權限設定

**位置**：管理設定 → 使用者權限

此頁可針對**個別使用者**細緻控管：

### Agent 權限
- 勾選 / 取消勾選，決定該使用者可使用哪些 Agent。
- 未勾選的 Agent 對該使用者完全隱藏。

### 模型權限
- 預設「繼承租戶全部」：使用者可選用所有租戶已啟用的模型。
- 若要限制，選擇「指定清單」，只勾選允許使用的模型。
- 適合將高成本模型（如 `gpt-4.1`）限制給特定職務。

### 儲存
設定完成後點擊 **儲存** 一次寫入角色 + Agent + 模型三項設定。

---

## 四、LLM 模型設定

**位置**：管理設定 → LLM 設定

設定公司可用的 AI 模型。詳細 Model ID 與 API Base URL 請參考 [AI 模型選型指南](help-llm-settings.md)。

### 新增 Provider 連線
1. 點擊 **＋ 新增**。
2. 選擇 Provider：

| Provider | 驗證方式 | 適用場景 |
|---|---|---|
| OpenAI | API Key | 雲端模型（GPT 系列） |
| Google AI Studio | API Key | Gemini 模型，開發與小型部署 |
| Google Vertex AI | GCP Project ID + Region + Service Account JSON（選填） | Gemini / Claude 企業版，支援 HIPAA/SOC2 |
| Anthropic | API Key | Claude 系列模型 |
| 台智雲 TWCC | API Key + API Base URL | 台灣自主 AI 算力 |
| 本機模型 (Local) | API Base URL | Ollama / LM Studio 自架模型 |

3. 填入對應驗證欄位，加入可用 Model ID 清單。
4. 點擊 **測試** 驗證連線正常，再 **儲存**。

> **Google Vertex AI 注意事項**：若 NeuroSme 部署於 GCP 環境且已設定 Application Default Credentials（ADC），Service Account JSON 可留空，GCP 將自動提供憑證。非 GCP 環境則需填入 Service Account JSON 金鑰內容。

### 刪除模型
點擊模型列的 🗑️，確認後移除。已使用此模型的設定不會自動更新，請提醒使用者切換。

> **Embedding 模型**：知識庫向量化模型一旦鎖定，更換需重新上傳所有文件。首次部署請謹慎選擇，建議使用 `text-embedding-3-small`（OpenAI）或 `nomic-embed-text`（Ollama 本機）。

---

## 五、Bot 部署管理（Widget Token）

**位置**：管理設定 → Bot 部署管理

KB Bot Builder 建立的 Bot 需由 admin 統一**開通 Widget Token** 後才能對外提供服務。

### 開通 Widget Token
1. 在 Bot 列表找到目標 Bot（狀態顯示「尚未開通」）。
2. 點擊 **開通 Token**，系統產生唯一的 Public Token。
3. 點擊 **嵌入碼**，複製 Widget URL 或 HTML 嵌入碼。

### 嵌入碼說明
- **Widget URL**：直接開啟的聊天頁面連結，可用 `<iframe>` 嵌入或以新視窗開啟。
- **HTML 嵌入碼**：含浮動聊天按鈕的完整程式碼，貼入目標網頁 `<body>` 底部即可。

### 撤銷 Widget Token
點擊 **撤銷**，Token 立即失效，所有已嵌入的 Widget 停止運作。對話紀錄不受影響。

---

## 六、知識庫管理

**位置**：管理設定 → 知識庫管理

管理員可檢視全租戶所有知識庫，並執行：

| 操作 | 說明 |
|------|------|
| **修改 Scope** | 切換為「個人私有」或「公司共用」（需 manager 以上建立） |
| **刪除** | 永久刪除知識庫及其所有文件，操作不可復原 |

> 知識庫 Scope 變更後立即生效：設為「公司共用」後，KB Bot Builder 即可引用；設回「個人私有」後，已引用此 KB 的 Bot 將無法查詢相關文件。

---

## 七、LLM Skills 管理

**位置**：管理設定 → LLM Skills

LLM Skills 是管理員為整個租戶維護的 **prompt 範本庫**，供 Writing Agent 等工具套用。使用者在寫作介面點擊「⚡ Skills」即可瀏覽並選用，不需要每次重新撰寫指令。

### 新增 Skill
1. 點擊右上角 **＋ 新增 Skill**。
2. 填入：
   - **Skill 名稱**（必填）：簡短易識別，例如「商業 Email 範本」
   - **分類**（選填）：自由輸入，例如「Email」、「報告」、「FAQ」，系統依此自動分群顯示
   - **簡短說明**（選填）：讓使用者快速了解此 Skill 的用途
   - **Prompt 內容**（必填）：使用者套用後帶入「對 AI 的指令」欄位的完整 prompt
   - **排序**：數字越小越前，用於控制同分類內的顯示順序
3. 點擊 **儲存**。

### 編輯 / 刪除 Skill
- 滑鼠移到列表上，右側出現 ✏️ 和 🗑️ 按鈕。
- 刪除後使用者的 Skill 庫立即不顯示此項目，已帶入 user prompt 欄位的內容不受影響。

### 分類顯示規則
- 有填分類的 Skill 依分類名稱分群顯示，並以 badge 標示。
- 未填分類的 Skill 歸入「未分類」，排在最後。
- 使用者在 Skill 庫 modal 中可依分類篩選或直接搜尋名稱／說明。

---

## 八、Agent 用量洞察

**位置**：管理設定 → 用量洞察

提供全平台 AI 使用行為分析，含四個頁籤：

| 頁籤 | 內容 |
|------|------|
| **健康狀態** | 各 Agent 成功率、錯誤次數、p50 延遲，快速識別異常 |
| **用量趨勢** | 每日請求量折線圖、Agent 請求排行、延遲趨勢 |
| **Token 用量** | 各模型 Token 消耗總量，估算 API 費用 |
| **使用者** | 活躍使用者排行、個人 Agent 使用明細、對話紀錄查閱 |

支援自訂日期範圍篩選（台北時區）。

---

## 常見問題

**Q：新使用者登入後看不到某個 Agent？**  
A：前往「使用者權限」，確認該 Agent 已為該使用者勾選啟用。

**Q：Bot Widget 嵌入後顯示空白？**  
A：確認 Widget Token 已開通（Bot 部署管理）；若仍空白，檢查客戶官網 CSP 是否允許 `frame-src` 載入 NeuroSme 網域。

**Q：LLM 測試失敗？**  
A：確認 API Key 有效、Model ID 格式正確（Google AI Studio 需加 `gemini/` 前綴、Vertex AI 需加 `vertex_ai/` 前綴、Ollama 需加 `local/` 前綴），並確認 API Base URL 網路可達。

**Q：LLM Skills 使用者看不到？**  
A：確認已有已儲存的 Skill 資料。使用者在 Writing Agent 中欄點擊「⚡ Skills」按鈕即可開啟 Skill 庫；若為空，顯示「尚未建立任何 Skill，請聯絡管理員」。

**Q：如何讓 Ollama 本機模型在 Docker 容器內可用？**  
A：API Base URL 填 `http://host.docker.internal:11434`（勿填 `localhost`，容器內 localhost 指向容器本身）。
