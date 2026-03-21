# 實作規劃：datasets = value_columns + indicators，顯示時依 display_fields 過濾
# （已完成 2025-03）

## 設計原則

1. **計算層**：datasets 含 value_columns 彙總 + 所有 indicator 計算結果
2. **展示層**：display_fields 為空 → 顯示全部；有值 → 依序過濾並排序
3. **having_filters**：可引用任何已計算欄位

---

## 修改清單

### 1. 新增共用函式 `_filter_datasets_by_display_fields`

位置：`_apply_display_fields` 附近（約 659 行後）
- 輸入：`datasets: list[tuple[str, list[float]]]`, `display_fields: list[str] | None`
- 邏輯：label 可能為 "銷售金額" 或 "銷售金額 - momo"，依 base 對應 _DISPLAY_FIELD_ALIASES
- 輸出：display_fields 為空 → 回傳原 datasets；有值 → 依 display_fields 順序過濾

### 2. 多 indicator 路徑（約 1348–1409 行）

**現狀**：只算 indicators + display_fields 中的 value
**目標**：先算全部 value_keys + indicators，再過濾

| 項目 | 修改 |
|------|------|
| value_keys_in_display | 改為 **all value_keys**（resolved.value_keys） |
| 彙總 | `_aggregate_multi_value_by_group(work, ..., resolved.value_keys, resolved.value_aggregations, ...)` |
| label_to_gv_val | 先放 indicator_results，再放全部 value 彙總 |
| 過濾 | 使用 _filter_datasets_by_display_fields，display_fields 為空時不濾 |

### 3. 單一 indicator 路徑（約 1446–1495 行）

**現狀**：extra_keys = value_keys[2:] + display_fields 中的 value
**目標**：extra_keys = 全部 value_keys，過濾交給 display_fields

| 項目 | 修改 |
|------|------|
| extra_keys | 改為 `list(resolved.value_keys)`，再合併 having_filters 引用欄位 |
| extra_aggs | `resolved.value_aggregations` 全長 |
| 條件 | 當 `len(resolved.value_keys) >= 2 and ind` 時，一律走此路徑（含 value_keys==2） |
| 過濾 | 沿用現有 display_fields 過濾邏輯 |

### 4. series + indicator 路徑 `_aggregate_multi_series_with_metrics`（約 889–965 行）

**現狀**：依 display_fields 決定 metrics_to_show，只計算要顯示的
**目標**：先算全部，再依 display_fields 過濾

| 項目 | 修改 |
|------|------|
| metrics_to_show | 改為「全部 value_keys + indicator」 |
| 建立 datasets_out | 照舊，但基於 metrics_to_show |
| 回傳前 | 若有 display_fields，用 _filter_datasets_by_display_fields 過濾 |

註：series 格式為 `{label} - {series_val}`，需支援 base 比對。

### 5. 不需修改的路徑

| 路徑 | 原因 |
|------|------|
| 1b series 無 indicator | 已全算 + 過濾 |
| 4 多 value 無 indicator | 已全算 + 過濾 |
| 5 pairs 路徑 | 已用 _apply_display_fields |
| __total__ 單一 indicator | 已用 raw_pairs 全算 + _apply_display_fields |

---

## 執行順序

1. 新增 `_filter_datasets_by_display_fields`
2. 修改多 indicator 路徑
3. 修改單一 indicator 路徑
4. 修改 `_aggregate_multi_series_with_metrics`
5. 更新 analysis_compute_LOGIC.md
6. 執行驗證測試
