# Intent JSON v4.0 → SQL 協議（SSOT）

**狀態**：本文件為 NeuroSme2.0 專案內 **Intent JSON v4.0 轉譯 SQL** 的**唯一真理來源（Single Source of Truth）**。

**範圍**：定義 JSON 語意、`mode` 分流、metric 三類型（normal / scalar / subset）、三種 JOIN 策略、SQL 生成演算法。自然語言→Intent 的 LLM 提示詞見 `config/system_prompt_analysis_intent_tool.md`。

**合規性（強制）**：所有 v4.0 SQL Generator 實作必須與本文件行為一致；若有差異，應視為 bug。

**參考實作**：`backend/app/services/compute_engine_sql_v4.py`（`try_build_sql_v4`）、結構驗證 `backend/app/schemas/intent_v4.py`。

**目標引擎**：DuckDB；實體表名固定為 **`data`**。

---

## 1. v4.0 vs v3.2 關鍵差異

| 項目 | v3.2 | v4.0 |
|------|------|------|
| 時間過濾 | `dims.time_filter` + `metrics.filters` 雙層鏡像 | **只在 `metrics.filters`**，無頂層 time_filter |
| 頂層 `filters` | calculate 模式有條件使用（容易出錯） | **calculate 模式強制為 `[]`** |
| 佔比分母語義 | `metrics.window: "total"`（命名不精確） | **`metrics.group_override: []`**（語義明確） |
| 父維度小計 | 不支援 | **`metrics.group_override: ["col_x"]`** |
| metric 自持性 | 繼承頂層 filters/time_filter | **完全自持，無繼承** |
| formula 驗證 | 無 | **Schema 層攔截非法 formula（衍生不可含聚合函數）** |

---

## 2. JSON 頂層結構

| 欄位 | 類型 | `calculate` | `list` | 說明 |
|------|------|-------------|--------|------|
| `version` | number / string | 必填 | 必填 | **`4.0`**（主版本須為 4） |
| `mode` | string | 可省略（預設 `calculate`） | **`list`** | 決定 SQL 解析路徑 |
| `dims` | object | 必填 | 必填 | 只含 `groups`（見 §2.1） |
| `filters` | array | **必須為 `[]`** | 選填 | 列級篩選，calculate 模式禁用 |
| `metrics` | array | **至少 1 筆** | **必須 `[]`** | 指標定義（見 §3） |
| `select` | array | 忽略 | **必填（≥1 col）** | 明細欄位，僅 `col_*` |
| `post_process` | object \| null | 選填 | 選填 | 聚合後條件／排序／上限（見 §5） |

### 2.1 `dims` 物件

| 欄位 | 說明 |
|------|------|
| `groups` | `string[]`。有分組需求時填入 schema 欄位或時間粒度表達式。list 模式通常為 `[]`。 |

**時間粒度選擇**（依問題用字對應 `dims.groups`）：

| 問法關鍵字 | `dims.groups` 寫法 | 說明 |
|---|---|---|
| 每天、按日 | `["col_date"]` | 直接放日期欄位，不加函數 |
| 每月、按月 | `["MONTH(col_date)"]` | 擷取月份整數（1–12） |
| 每季、按季 | `["QUARTER(col_date)"]` | 擷取季度整數（1–4） |
| 每年、按年 | `["YEAR(col_date)"]` | 擷取年份整數 |

> **自動排序**：Engine 偵測到 `MONTH/YEAR/QUARTER` 函數時，若 `post_process.sort` 未指定，自動補 `ORDER BY dim_{i} ASC`，確保時序正確。

> **標籤格式化**：`MONTH` → `"3月"`；`QUARTER` → `"Q1"`；直接日期欄位 → `"2025-03-15"`。

**v4.0 無 `time_filter` 欄位**：時間條件統一在 `metrics.filters` 中定義。

### 2.2 `mode` 判斷規則

| `mode` | 適用情境 |
|--------|----------|
| `calculate`（預設） | 需要分組聚合（GROUP BY + SUM/COUNT 等）。**即使問句含「列出」「顯示」「各X的Y」等字詞，只要涉及聚合，一律用 `calculate`。** |
| `list` | 查詢**每一筆原始資料**（無分組、無聚合）。判斷依據：是否要看每一筆交易/訂單/記錄的明細，而非彙總數字。 |

### 2.3 `FilterClause`

| 欄位 | 說明 |
|------|------|
| `col` | 實體欄位代碼 `col_*`（`metrics.filters` 脈絡），或 metric `alias`（`post_process.where` 脈絡）。 |
| `op` | 僅允許：`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `contains`, `is_null`, `is_not_null`。 |
| `val` | 依 `op`；`between` 為長度 2 陣列；`is_null`/`is_not_null` 無需 `val`。 |

### 2.4 `metrics[]` 單筆

| 欄位 | 必要性 | 說明 |
|------|--------|------|
| `id` | 必填 | 指標鍵（如 `m1`）；衍生算式以 `\bm\d+\b` 引用 |
| `alias` | 必填 | SQL 安全別名：`^[a-zA-Z_][a-zA-Z0-9_]*$`，用於 SQL 與內部引用 |
| `label` | 必填 | 繁體中文顯示名稱（2–6 字），用於圖表與摘要；不影響 SQL |
| `formula` | 必填 | 見 §3 原子 vs 衍生（**schema 層驗證**） |
| `filters` | 選填（預設 `[]`） | 原子 metric 自持過濾；衍生 metric 必須為 `[]` |
| `group_override` | 選填（預設 `null`） | 見 §3.3 分組覆寫 |

---

## 3. 指標分類（formula 契約）

### 3.1 原子指標（Atomic）

- **語法**：`AGG(col_x)`，整段 `formula` 僅為此呼叫。
- **允許的 `AGG`**：`SUM`, `AVG`, `COUNT`, `MIN`, `MAX`（大小寫不敏感）。
- **`col_x`**：必須存在於 schema 欄位白名單；使用 prompt 範例中的佔位符（`col_x`、`col_b` 等）會在 engine 驗證時報錯。
- 每個原子指標對應**一個** CTE。

### 3.2 衍生指標（Derived）

- **語法**：僅使用已宣告之 `m1`, `m2`, …、四則運算、括號。
- **禁止**：在衍生 `formula` 內出現聚合函數（`SUM`/`COUNT` 等）或裸 `col_*`。Schema 層會攔截並回傳具體錯誤訊息。
- **`filters`**：必須為空陣列 `[]`。
- **`group_override`**：衍生指標此欄位無意義（引擎忽略）。

**常見錯誤範例**：

```
❌ 錯誤：formula: "(SUM(col_11) - SUM(col_12)) / SUM(col_11)"
✅ 正確：拆成三個 metrics：
   m1: SUM(col_11)   ← atomic
   m2: SUM(col_12)   ← atomic
   m3: (m1 - m2) / m1  ← derived（只引用 m1, m2）
```

**判斷規則**：需要「兩個欄位的比值/差值」時，必定需要 3 個 metrics（m1 atomic + m2 atomic + m3 derived）。

### 3.3 `group_override`（分組覆寫，原子指標專用）

| `group_override` 值 | 類型 | CTE GROUP BY | 合併方式 | 典型用途 |
|---------------------|------|--------------|----------|----------|
| `null`（省略） | **normal** | 所有 `dims.groups` | FULL OUTER JOIN | 一般分組聚合 |
| `[]` | **scalar** | 無（純量 CTE） | CROSS JOIN | 佔比分母（整體合計） |
| `["col_x", …]` | **subset** | 指定子集維度 | LEFT JOIN | 父維度小計 |

**約束**：`group_override` 的所有元素必須是 `dims.groups` 的子集；違反時 schema 驗證失敗。

### 3.4 除法與型別

- 若 `formula` 在頂層 `/` 可分割為 `分子 / 分母`，產出等價於 `(分子) / NULLIF(分母, 0)`，避免除以零。
- 所有 `m*` 一律替換為 `CAST(<alias> AS DOUBLE)`。

---

## 4. 解析路徑：`mode: calculate` vs `mode: list`

### 4.1 `calculate`

1. 驗證：`metrics.length ≥ 1`；`filters` 必須為 `[]`；`select` 不使用。
2. 分類 metrics → atomic（normal / scalar / subset）、derived。
3. 衍生：依賴圖拓樸排序；有環 → 失敗。
4. 至少一個 atomic；全為 derived → 失敗。
5. 組 SQL（§6）；`post_process` 附加於外層。

### 4.2 `list`

1. 驗證：`metrics` 必須為 `[]`；`select` 至少一欄且均在 schema 白名單。
2. 單一 `SELECT` 於 `data`：`WHERE` = `filters` ∪ `post_process.where`。
3. `LIMIT` = `min(post_process.limit, 100)`；未給時預設 100。

---

## 5. `post_process`

| 欄位 | 說明 |
|------|------|
| `where` | 聚合後門檻過濾（等效 SQL HAVING）。**`col` 必須為某個 metric 的 `alias`**（非 `col_*` 欄位名）；`list` 模式中 `col` 為實體欄位。 |
| `sort` | `{ col, order: "asc"\|"desc" }[]`；`col` 可為 metric alias 或 `dims.groups` 欄位名稱。 |
| `limit` | 正整數；`list` 實際 `LIMIT = min(limit, 100)`。 |

**`where` 的條件類型區分**：

| 條件類型 | 放置位置 | 範例 |
|---|---|---|
| 原始列篩選（品牌、類別） | `metrics.filters` | `col_c eq "乳品"` |
| 聚合後門檻（銷售額 > 100） | `post_process.where` | `col = "sales_2025", op = "gt", val = 100` |

---

## 6. SQL 生成演算法（calculate 模式）

### 6.1 分類 atomic metrics

```
normal_ids  = [m for m in atomics if m.group_override is None]
scalar_ids  = [m for m in atomics if m.group_override == []]
subset_ids  = [m for m in atomics if m.group_override is non-empty list]
```

### 6.2 第一階段：CTE 建立

| 類型 | CTE 結構 |
|------|----------|
| normal | `SELECT _g0, _g1, …, AGG(col) AS alias FROM data WHERE … GROUP BY col_x, col_y` |
| scalar | `SELECT AGG(col) AS alias FROM data WHERE …`（**無** GROUP BY） |
| subset | `SELECT _g{i}, AGG(col) AS alias FROM data WHERE … GROUP BY col_subset`（僅包含 group_override 對應索引的 `_g{i}`） |

**subset 的 `_g{i}` 標號**：與 `dims.groups` 的索引對應。例如 `dims.groups = ["col_5", "col_4"]`，`group_override = ["col_5"]` → CTE 只有 `_g0`（col_5 在 index 0）。

### 6.3 第二階段：merge_sql

**anchor 確定**：normal_ids 為 anchor（t0, t1, …）；若無 normal，取第一個 subset 為 anchor。

```sql
SELECT
  COALESCE(t0._g0, t1._g0, …) AS dim_0,   -- 來自 anchor metrics
  COALESCE(t0._g1, t1._g1, …) AS dim_1,
  t0.m1_alias,                              -- normal metrics
  s0.m2_alias,                              -- subset metrics
  w0.m3_alias                               -- scalar metrics
FROM cte_normal_0 t0
FULL OUTER JOIN cte_normal_1 t1 ON t0._g0 = t1._g0 AND t0._g1 = t1._g1
LEFT JOIN cte_subset_0 s0 ON t0._g0 = s0._g0        -- 依 group_override 索引
CROSS JOIN cte_scalar_0 w0
```

### 6.4 衍生指標投影（與 v3.2 相同）

1. **無衍生**：`inner = merge_sql`。
2. **扁平衍生**（所有衍生只依賴 atomic）：`inner = SELECT mrg.*, derived_expr FROM (merge_sql) AS mrg`。
3. **鏈式衍生**：逐層巢狀，`mrg → x1 → x2 …`，各層 `SELECT prev.*, new_expr`。

最終：`SELECT * FROM (inner) AS v0 [WHERE …] [ORDER BY …] [LIMIT …]`

### 6.5 自動排序（時間維度）

若 `dims.groups` 含時間函數（`MONTH`、`YEAR`、`QUARTER`），且 `post_process.sort` 未指定，引擎自動在最終 SQL 補 `ORDER BY dim_{i} ASC`。

---

## 7. 範例 Intent JSON（v4.0）

> **注意**：以下範例中的 `col_brand`、`col_amount`、`col_date` 等均為說明用佔位符，實際輸出時必須換成 schema 中的真實欄位代碼（如 `col_1`、`col_11`）。

### 範例 A：各品牌佔乳品大類比例（全局 scalar）

```json
{
  "version": "4.0",
  "dims": { "groups": ["col_brand"] },
  "filters": [],
  "metrics": [
    { "id": "m1", "alias": "brand_sales", "formula": "SUM(col_amount)",
      "filters": [{ "col": "col_category", "op": "eq", "val": "乳品" }] },
    { "id": "m2", "alias": "total_dairy", "formula": "SUM(col_amount)",
      "group_override": [],
      "filters": [{ "col": "col_category", "op": "eq", "val": "乳品" }] },
    { "id": "m3", "alias": "ratio", "formula": "m1 / m2", "filters": [] }
  ]
}
```

### 範例 B：各品類 × 各品牌佔本品類比例（父維度小計）

```json
{
  "version": "4.0",
  "dims": { "groups": ["col_category", "col_brand"] },
  "filters": [],
  "metrics": [
    { "id": "m1", "alias": "brand_sales",    "formula": "SUM(col_amount)", "filters": [] },
    { "id": "m2", "alias": "category_total", "formula": "SUM(col_amount)",
      "group_override": ["col_category"], "filters": [] },
    { "id": "m3", "alias": "share", "formula": "m1 / m2", "filters": [] }
  ]
}
```

### 範例 C：同期對比 + 聚合後篩選（HAVING）

```json
{
  "version": "4.0",
  "dims": { "groups": ["col_brand"] },
  "filters": [],
  "metrics": [
    { "id": "m1", "alias": "sales_2025", "formula": "SUM(col_amount)",
      "filters": [{ "col": "col_date", "op": "between", "val": ["2025-03-01", "2025-03-31"] }] },
    { "id": "m2", "alias": "sales_2024", "formula": "SUM(col_amount)",
      "filters": [{ "col": "col_date", "op": "between", "val": ["2024-03-01", "2024-03-31"] }] },
    { "id": "m3", "alias": "growth_rate", "formula": "(m1 - m2) / m2", "filters": [] }
  ],
  "post_process": {
    "where": { "col": "sales_2025", "op": "gt", "val": 100 }
  }
}
```

> `post_process.where.col` 必須是 metric alias（`sales_2025`），不是 `col_*` 欄位名。

### 範例 D：Top N + 複合排序

```json
{
  "version": "4.0",
  "dims": { "groups": ["col_product"] },
  "filters": [],
  "metrics": [
    { "id": "m1", "alias": "total_sales",        "formula": "SUM(col_amount)", "filters": [] },
    { "id": "m2", "alias": "total_cost",          "formula": "SUM(col_cost)",   "filters": [] },
    { "id": "m3", "alias": "gross_margin_ratio",  "formula": "(m1 - m2) / m1",  "filters": [] }
  ],
  "post_process": {
    "sort": [
      { "col": "total_sales",       "order": "desc" },
      { "col": "gross_margin_ratio","order": "desc" }
    ],
    "limit": 10
  }
}
```

### 範例 E：時間趨勢（按月，引擎自動排序）

```json
{
  "version": "4.0",
  "dims": { "groups": ["MONTH(col_date)"] },
  "filters": [],
  "metrics": [
    { "id": "m1", "alias": "monthly_sales", "formula": "SUM(col_amount)",
      "filters": [{ "col": "col_date", "op": "between", "val": ["2025-01-01", "2025-12-31"] }] }
  ]
}
```

> 未指定 `post_process.sort` 時，引擎自動補 `ORDER BY dim_0 ASC`；labels 格式化為 `["1月", "2月", …]`。

### 範例 F：時間趨勢（按日）

```json
{
  "version": "4.0",
  "dims": { "groups": ["col_date"] },
  "filters": [],
  "metrics": [
    { "id": "m1", "alias": "daily_sales", "formula": "SUM(col_amount)",
      "filters": [{ "col": "col_date", "op": "between", "val": ["2025-03-01", "2025-03-31"] }] }
  ]
}
```

> 每天 → 直接用日期欄位，不套函數；labels 為日期字串（`"2025-03-01"`）。

### 範例 G：明細查詢（list）

```json
{
  "version": "4.0",
  "mode": "list",
  "select": ["col_order_no", "col_date", "col_amount"],
  "dims": { "groups": [] },
  "filters": [{ "col": "col_category", "op": "eq", "val": "乳品" }],
  "metrics": [],
  "post_process": {
    "where": { "col": "col_amount", "op": "gt", "val": 1000 },
    "sort": [{ "col": "col_date", "order": "desc" }],
    "limit": 20
  }
}
```

---

## 8. 實作合規檢查清單

- [ ] `list`：`metrics` 為空；`select` 在白名單；`LIMIT ≤ 100`；`filters` 有效。
- [ ] `calculate`：頂層 `filters` 必須為空 `[]`；至少一個 atomic；衍生依賴可拓樸、無環。
- [ ] atomic CTE：`SELECT ... AS _g{i}` 與 `GROUP BY` 使用同一表達式；subset 只包含對應索引的 `_g{i}`。
- [ ] normal metrics 之間：`FULL OUTER JOIN` on 所有 `_g{i}`。
- [ ] subset metrics：`LEFT JOIN` from anchor on 其 `group_override` 對應的 `_g{i}` 索引。
- [ ] scalar metrics：`CROSS JOIN`（無 ON 條件）。
- [ ] `dim_{i}` = `COALESCE` 跨所有 anchor CTEs；scalar/subset metrics 不貢獻 `dim_` 欄。
- [ ] 衍生：`m*` → `CAST(alias AS DOUBLE)`；頂層 `/` → `NULLIF(分母, 0)`。
- [ ] 最外層一律 `SELECT * FROM (inner) AS v0`；`post_process` 掛在 v0 之後。
- [ ] `group_override` 非 null 時，其所有元素必須是 `dims.groups` 的子集。
- [ ] atomic formula 欄位必須在 schema allowlist 中；不存在時報具體欄位名錯誤。
- [ ] derived formula 不得含原始聚合函數（`SUM`/`COUNT` 等）；schema 層驗證攔截。
- [ ] 時間函數分組（MONTH/YEAR/QUARTER）且未指定 sort → 自動補 `ORDER BY dim_{i} ASC`。
- [ ] 無法滿足本協議時：明確失敗，不產生任意拼接 SQL。

---

## 9. 修訂紀錄

| 日期 | 說明 |
|------|------|
| 2026-03-28 | v4.0 初版：移除 `dims.time_filter`、廢除 calculate 模式頂層 `filters`、以 `group_override` 取代 `window`，支援 normal / scalar / subset 三種 JOIN 策略。 |
| 2026-03-28 | 補充：`mode` 判斷規則（「列出」不等於 list）；`dims.groups` 時間粒度對照表（每日 = 直接日期欄位）；`formula` 衍生指標禁止含原始聚合函數（schema 層驗證）；`post_process.where.col` 必須為 metric alias；引擎自動補時間排序；月份/季度 label 格式化。 |
| 2026-03-28 | 新增 `MetricV4.label`：繁體中文顯示名稱，與 SQL alias 分離，用於圖表 dataset 標籤與 LLM 摘要顯示。LLM prompt 更新為必填。 |

文件結束。
