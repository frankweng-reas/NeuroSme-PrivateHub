# Analysis Compute 架構說明

## 一、整體流程（chat_compute_tool.py）

```
使用者問題
    ↓
[1] 取得 bi_sources 資料（DuckDB 或 CSV）
    ↓
[2] LLM 意圖萃取 → intent JSON
    ↓
[3] compute_aggregate(rows, intent) → chart_result
    ↓
[4] LLM 文字生成（依 chart_result 撰寫分析）
    ↓
回傳 { content, chart_data, debug }
```

---

## 二、analysis_compute.py 模組架構

### 2.1 層級劃分

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1：資料輸入                                                │
│  parse_csv_content()  infer_schema()  get_schema_summary()        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2：欄位解析（Intent → 實際欄位）                            │
│  _find_matching_column()  _parse_num()  _apply_filter()          │
│  _GROUP_ALIASES  _VALUE_ALIASES                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3：彙總計算（核心）                                         │
│  compute_aggregate()                                             │
│    ├─ 單一系列（pie / bar / line）                                 │
│    └─ 多系列（series_by：各產品隨時間）                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4：後處理                                                   │
│  sort_order  top_n  time_order  pie 百分比                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、compute_aggregate 處理流程

### 3.1 輸入參數

| 參數 | 必填 | 說明 |
|------|------|------|
| rows | ✓ | 原始資料（list of dict） |
| group_by_column | ✓ | 分組欄位（X 軸或類別） |
| value_column | * | 數值欄位（與 value_columns 二擇一） |
| value_columns | * | 寬格式時，多個數值欄位（如 1月、2月、3月） |
| aggregation | ✓ | sum / count / avg |
| chart_type | ✓ | pie / bar / line |
| series_by_column | | 多系列時，每條線的類別欄位 |
| filter_column | | 篩選欄位 |
| filter_value | | 篩選值（單一或 list） |
| top_n | | 前 N 名 |
| sort_order | | desc / asc |
| time_order | | X 軸是否按時間排序 |

### 3.2 處理步驟（依序）

```
Step 0：解析 value 欄位
├─ value_columns 有值 → 多欄加總（寬格式）
└─ value_column 有值 → 單一欄位
    └─ 模糊匹配：_find_matching_column(_, _, _VALUE_ALIASES)

Step 1：篩選（filter）
├─ filter_column + filter_value 有值
└─ 大小寫不敏感比對

Step 2：解析 group_key、series_key
├─ 精確匹配 actual_keys
└─ 模糊匹配 _GROUP_ALIASES

Step 3：分支
├─ 有 series_key → 多系列流程
└─ 無 series_key → 單一系列流程
```

### 3.3 單一系列流程

```
for each row:
    group_val = row[group_key]
    value = sum(row[k] for k in value_keys)   # 支援多欄加總
    groups[group_val] += value  (或 count/avg)

排序：time_order ? 時間序 : 依 value desc/asc
截斷：top_n

pie ? 轉百分比 : 保持原值

輸出：{ labels, data, chartType, valueSuffix }
```

### 3.4 多系列流程（series_by）

```
for each row:
    group_val = row[group_key]   # X 軸，如月份
    series_val = row[series_key] # 每條線，如產品
    value = sum(row[k] for k in value_keys)
    pivot[(group_val, series_val)] += value

group_vals = 排序（time_order ? 時間序）
series_vals = 排序（可依總和 + top_n）

輸出：{ labels: group_vals, datasets: [{ label, data }], chartType }
```

---

## 四、資料格式對應

### 4.1 長格式（Long）

```
平台, 產品, 月份, 銷售額
momo, A, 1月, 5000
momo, A, 2月, 6000
```

- value_column: "銷售額"
- group_by: "產品" 或 "月份"
- series_by: 另一維度（趨勢時）

### 4.2 寬格式（Wide）

```
平台, 產品, 1月, 2月, 3月
momo, A, 5000, 6000, 8680
```

- value_columns: ["1月", "2月", "3月"]
- 每列加總 1月+2月+3月 後再 group_by

---

## 五、統一 Schema 與欄位匹配

### 5.1 統一欄位（Canonical）

| 類型 | 統一欄位 | 說明 |
|------|----------|------|
| 分組 | 平台、月份、產品名稱、品類 | X 軸或類別 |
| 數值 | 銷售金額、銷售數量 | 彙總目標 |

不同 CSV 的欄位（如門市、銷售金額(元)）透過別名對應到統一欄位。

### 5.2 匹配邏輯（_find_matching_column）

```
1. 完全匹配：intent == column
2. 包含匹配：intent in column 或 column in intent
3. 別名匹配：_GROUP_ALIASES / _VALUE_ALIASES
```

---

## 六、chat_compute_tool 與 analysis_compute 職責

| 模組 | 職責 |
|------|------|
| chat_compute_tool.py | API、取得資料（DuckDB）、意圖萃取、compute_aggregate、LLM 文字生成 |
| analysis_compute.py | 純計算：parse、schema、aggregate，不依賴 HTTP/DB |

---

## 七、實作對應（analysis_compute.py）

| 函式 | 職責 |
|------|------|
| `parse_csv_content` | CSV 字串 → list[dict] |
| `infer_schema` | 推斷欄位型別（number/string） |
| `get_schema_summary` | 產生給 LLM 的 schema 摘要 |
| `_resolve_columns` | Intent 欄位名 → 實際 row keys（含 group_key, value_keys, filter_key, series_key） |
| `_apply_filter` | 依 filter_key + filter_value 篩選 |
| `_aggregate_single_series` | 單一系列彙總 → [(label, value)] |
| `_aggregate_multi_series` | 多系列 pivot → (labels, datasets) |
| `_apply_sort_top_n` | 排序 + top_n 截斷 |
| `_to_pie_percent` | 轉百分比 |
| `compute_aggregate` | 主入口，串接上述流程 |

---

## 八、建議改進（可選）

1. **參數物件化**：將 compute_aggregate 的 12 個參數改為 `ComputeIntent` dataclass
2. **錯誤訊息**：回傳更具體的錯誤（如「找不到欄位 X，可用欄位：[...]」）
