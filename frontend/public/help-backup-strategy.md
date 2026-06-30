# NeuroSme Private Hub 資料備份與還原指南

## 備份什麼？

只需備份 **`~/neurosme-data/`** 整個目錄。所有業務資料都在這裡；安裝包目錄（`~/neurosme`）可重新解壓，**不需備份**。

| 子目錄 | 內容 |
|--------|------|
| `postgres/` | NeuroSme 資料庫（設定、知識庫、對話紀錄等） |
| `localauth/` | 帳號與認證資料庫 |
| `stored_files/` | 上傳檔案、知識庫文件本體 |
| `duckdb/` | Business Insight 分析使用之資料庫 |
| `csv_import/` | CSV 匯入相關資料 |

範例（停止服務後執行）：

```bash
tar czf ~/neurosme-backup-$(date +%Y%m%d).tar.gz -C ~ neurosme-data/
```

---

## 備份注意事項

備份前**必須先停止服務**，確保資料一致性後再複製目錄：

```bash
# 停止服務
cd ~/neurosme && docker compose down

# ── 在此執行備份 ──

# 備份完成後重新啟動
docker compose up -d
```

> 服務停止時間通常 < 30 秒。建議安排在離峰時段執行。

---

## 還原方法

```bash
# 1. 停止服務
cd ~/neurosme && docker compose down

# 2. 移除現有資料
rm -rf ~/neurosme-data/

# 3. 從備份還原 neurosme-data/ 目錄

# 4. 重新啟動
docker compose up -d
```

---

## 其他說明

- **升級前**：版本升級或重大設定變更前，建議先手動備份一次
- **密碼安全**：備份檔包含帳號密碼資料（加密儲存），請依資安規範管控備份目錄的存取權限
