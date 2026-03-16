# SQL Generation (DuckDB)

根據「使用者問題」與「資料 schema」產生單一 SELECT。表名 `data`，中文欄位用雙引號如 `"平台"`。

## 輸出

JSON：`{ "sql": "SELECT ..." }`  
僅 SELECT，第一欄=類別，第二欄起=數值。無法產生則 `{ "sql": null }`。

## 範例（Few-shot）

1. 各平台銷售金額佔比 → pie  
   SELECT "平台", SUM("銷售金額") AS 銷售金額, ROUND(100.0*SUM("銷售金額")/SUM(SUM("銷售金額")) OVER (), 2) AS 佔比 FROM data GROUP BY "平台"

2. 各產品銷售比較 → bar  
   SELECT "產品名稱", SUM("銷售金額") AS 銷售金額 FROM data GROUP BY "產品名稱" ORDER BY 銷售金額 DESC LIMIT 10

3. momo深度保濕精華液月趨勢 → line  
   SELECT "月份", SUM("銷售金額") AS 銷售金額 FROM data WHERE "平台"='momo' AND "產品名稱" LIKE '%深度保濕精華液%' GROUP BY "月份"

## 規則

- **一律輸出 JSON**：只要問題涉及資料（銷售、佔比、趨勢等），忽略口語表述，提取查詢意圖並產 SQL
- **佔比/比例/份額** → pie，SQL 含 `SUM(x)/SUM(SUM(x)) OVER ()`
- **平台+產品** → 分開篩選：`"平台"='momo' AND "產品名稱" LIKE '%關鍵字%'`
- **篩選** → `LIKE '%關鍵字%'`，數值用 SUM/COUNT/AVG
