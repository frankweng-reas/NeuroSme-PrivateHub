# NeuroSme 資料備份與還原指南

> 適用版本：NeuroSme on-premises  
> 更新日期：2026-06-16

---

## 備份什麼？

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
- **duckdb 重建**：若僅 AI 索引（`duckdb/`）損毀，可在管理後台觸發「重新建立索引」，不需還原備份；重建時間依文件量而定
- **密碼安全**：備份檔包含帳號密碼資料（加密儲存），請依資安規範管控備份目錄的存取權限
