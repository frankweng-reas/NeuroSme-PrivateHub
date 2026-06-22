# KB 圖文呈現 — 設計討論記錄

> 討論日期：2026-06-19

---

## 問題背景

用戶的原始資料（如 SOP、操作手冊）是圖文並茂的文件。  
現有 KB 只能存文字，圖片資訊在上傳時被丟失，無法還原原始的圖文呈現。

---

## 核心結論：不在 chunk 裡塞圖，改為「原文瀏覽器」

### 錯誤方向（放棄）

在每個 KB chunk 裡嵌圖片 URL，讓 LLM 回答時同時顯示圖片。

**放棄原因：**
- 一份文件可能有數十張圖，每張都要獨立存 URL，管理複雜
- 不同文件結構差異極大（SOP、型錄、報告），通用解析邏輯難維護
- 圖片歸屬（這張圖屬於哪個 chunk）程式很難判斷正確
- 需要一套完整的 media storage 系統

### 正確方向（採用）

KB 只負責「找到相關段落」，圖文呈現交給**原始文件本身**。

```
用戶提問
  → KB retrieval 找到相關 chunk（文字）
  → LLM 根據文字給出答案
  → 同時附上「查看原文」按鈕，標記來源頁碼
  → 點擊後在 App 內側欄開啟 PDF viewer，直接跳到對應頁
```

---

## 現況盤點

### 問題一：原始檔案沒有保留

`km.py` 上傳流程讀取 `file_bytes`，抽完文字後**原始檔案即丟棄**，DB 只存 metadata。

```python
# km.py 第 171 行
file_bytes = await file.read()
# ... 抽文字 ...
# file_bytes 之後沒有被存到任何地方
```

→ **需補上：上傳時同時把原始檔存到 storage。**

### 問題二：chunk 沒有記錄頁碼

現有 `km_chunks.metadata_` 只有：

```json
{"filename": "SOP.pdf", "chunk_index": 0}
```

沒有 `page_start`。

### 好消息：頁碼資訊已在文字裡

`document_service.py` 的 `_extract_pdf()` 抽文字時，**每頁已自動加上標記**：

```
[第 1 頁]
Step 1: xxxx...

[第 2 頁]
Step 2: yyyy...
```

這段文字會傳進 `process_document()`，所以 chunking 時**只需用正則解析標記**即可取得頁碼，不需要改抽取流程。

---

## 需要做的改動（全部）

### 後端

| # | 檔案 | 改動內容 | 難度 |
|---|---|---|---|
| 1 | `km.py` | 上傳時用 `write_blob()` 存原始 PDF bytes | 低 |
| 2 | `km_documents` | 新增欄位記錄 `stored_file_id`（或存 path） | 低 |
| 3 | `km_service.py` | chunking 時解析 `[第 N 頁]` 標記，寫入 `metadata_["page_start"]` | 低 |
| 4 | `km.py` | 新增 `GET /km/documents/{doc_id}/file` endpoint，serve 原始 PDF | 低 |

### 前端

| # | 改動內容 | 難度 |
|---|---|---|
| 5 | KB 搜尋結果 / LLM 回答的 citation，加「查看原文 p.N」按鈕 | 低 |
| 6 | 側欄 PDF viewer（react-pdf 或 iframe + PDF.js），`#page=N` 跳頁 | 中 |

---

## 技術細節

### 頁碼解析（改動點 #3）

```python
import re

def _extract_page_start(content: str) -> int | None:
    m = re.search(r'\[第\s*(\d+)\s*頁', content)
    return int(m.group(1)) if m else None
```

寫 chunk 時：

```python
# km_service.py 第 651 行附近
metadata_={
    "filename": doc.filename,
    "chunk_index": idx,
    "page_start": _extract_page_start(chunk_content),  # 新增
}
```

### PDF 跳頁（前端改動點 #6）

PDF.js / iframe 支援 URL hash 跳頁：

```
GET /api/v1/km/documents/{doc_id}/file#page=50
```

react-pdf 也可透過 `pageNumber` prop 直接跳頁。

---

## 尚未討論的問題

- [ ] DOCX、TXT 等非 PDF 格式的「查看原文」怎麼處理？（目前無頁碼概念）
- [ ] 原始 PDF 的存取權限控制（需要 auth token？）
- [ ] 儲存空間：原始 PDF 保留多久？刪除文件時一起刪？
- [ ] 現有已上傳的文件沒有存原始檔，怎麼處理（提示用戶重新上傳？）
