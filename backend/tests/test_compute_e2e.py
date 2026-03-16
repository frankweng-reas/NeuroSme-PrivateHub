"""
端對端測試：模擬 chat_compute 流程（不含 LLM）
驗證「momo深度保濕精華液的銷售額」在各種 intent 下都能正確回答
"""
import importlib.util
import re
import sys

sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("ac", "app/services/analysis_compute.py")
ac = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ac)


def get_schema_summary(rows):
    schema = ac.infer_schema(rows)
    cols = list(schema.keys())
    sample = rows[0] if rows else {}
    sample_str = ", ".join(f"{k}={repr(sample.get(k, ''))[:30]}" for k in cols[:8])
    return f"欄位：{cols}\n型別：{schema}\n第一列範例：{sample_str}"


def safe_int(v):
    if v is None:
        return None
    try:
        return int(v) if v else None
    except (TypeError, ValueError):
        return None


CSV = """平台,月份,產品名稱,銷售數量,銷售金額
momo,1月,momo深度保濕精華液,10,1000
momo,2月,momo 深度保濕精華液,5,500
pchome,1月,其他產品,20,2000"""

USER_CONTENT = "momo深度保濕精華液的銷售額"


def run_flow(intent: dict) -> dict | None:
    """模擬 chat_compute 的 intent 流程"""
    rows = ac.parse_csv_content(CSV)
    if not rows:
        return None
    schema_summary = get_schema_summary(rows)

    group_by = intent.get("group_by_column")
    filter_col = intent.get("filter_column")
    filter_val = intent.get("filter_value")

    # 補強：問「X的銷售額」時
    if "的銷售額" in USER_CONTENT:
        m = re.search(r"(.+?)的銷售額", USER_CONTENT.strip())
        has_product_col = any(k in schema_summary for k in ("產品名稱", "產品", "商品名稱", "商品", "品名"))
        has_value_col = any(k in schema_summary for k in ("銷售金額", "銷售額", "銷售數量", "金額", "數量"))
        if m and has_product_col and has_value_col:
            inferred_product = re.sub(r"[\s,，、]+", "", m.group(1).strip())
            group_by = "產品名稱"
            filter_col = "產品名稱"
            filter_val = inferred_product
            if not intent.get("value_column"):
                intent = dict(intent)
                intent["value_column"] = "銷售金額" if "銷售金額" in schema_summary else ("銷售額" if "銷售額" in schema_summary else "銷售數量")

    if not (group_by or "").strip():
        return None

    filters = None
    if isinstance(intent.get("filters"), list):
        filters = [{"column": str(f.get("column", "")).strip(), "value": f.get("value")} for f in intent.get("filters", []) if isinstance(f, dict) and f.get("column") is not None]
        filters = filters if filters else None
    elif filter_col and filter_val is not None:
        filters = [{"column": filter_col, "value": filter_val}]
    chart_result = ac.compute_aggregate(
        rows,
        group_by,
        intent.get("value_column"),
        intent.get("aggregation") or "sum",
        intent.get("chart_type") or "bar",
        series_by_column=intent.get("series_by_column"),
        filters=filters,
        top_n=safe_int(intent.get("top_n")),
        sort_order=intent.get("sort_order") or "desc",
        time_order=intent.get("time_order") in (True, "true", 1),
        value_columns=intent.get("value_columns")
        if isinstance(intent.get("value_columns"), list)
        else ([intent.get("value_columns")] if intent.get("value_columns") else None),
        indicator=intent.get("indicator") if isinstance(intent.get("indicator"), str) else None,
    )
    return chart_result


def test_wrong_intent_no_filter():
    """LLM 輸出錯誤：無 filter"""
    intent = {
        "group_by_column": "平台",
        "value_column": "銷售金額",
        "aggregation": "sum",
        "chart_type": "bar",
        "filter_column": None,
        "filter_value": None,
    }
    r = run_flow(intent)
    assert r, "應由補強修正，不應失敗"
    total = sum(r["data"])
    assert total == 1500, f"預期 1500（momo深度保濕精華液），實際 {total}"


def test_wrong_intent_wrong_group():
    """LLM 輸出錯誤：group_by=平台"""
    intent = {
        "group_by_column": "平台",
        "value_column": "銷售金額",
        "filter_column": None,
        "filter_value": None,
    }
    r = run_flow(intent)
    assert r, "應由補強修正"
    total = sum(r["data"])
    assert total == 1500, f"預期 1500，實際 {total}"


def test_correct_intent():
    """LLM 輸出正確"""
    intent = {
        "group_by_column": "產品名稱",
        "value_column": "銷售金額",
        "filter_column": "產品名稱",
        "filter_value": "momo深度保濕精華液",
    }
    r = run_flow(intent)
    assert r
    assert sum(r["data"]) == 1500


def test_different_column_names():
    """CSV 欄位為 商品名稱、銷售額（非 產品名稱、銷售金額）"""
    csv2 = """平台,月份,商品名稱,銷售數量,銷售額
momo,1月,momo深度保濕精華液,10,1000
pchome,1月,其他產品,20,2000"""
    rows = ac.parse_csv_content(csv2)
    schema_summary = get_schema_summary(rows)
    assert "商品名稱" in schema_summary and "銷售額" in schema_summary
    # 補強會設 group_by=產品名稱，_resolve_columns 會透過 alias 對應到 商品名稱
    intent = {"group_by_column": "平台", "value_column": None, "filter_column": None, "filter_value": None}
    group_by, filter_col, filter_val = "平台", None, None
    if "的銷售額" in USER_CONTENT:
        m = re.search(r"(.+?)的銷售額", USER_CONTENT.strip())
        has_product_col = any(k in schema_summary for k in ("產品名稱", "產品", "商品名稱", "商品", "品名"))
        has_value_col = any(k in schema_summary for k in ("銷售金額", "銷售額", "銷售數量", "金額", "數量"))
        if m and has_product_col and has_value_col:
            group_by = "產品名稱"
            filter_col = "產品名稱"
            filter_val = m.group(1).strip()
            intent = dict(intent)
            intent["value_column"] = "銷售金額" if "銷售金額" in schema_summary else "銷售額"
    filters = [{"column": filter_col, "value": filter_val}] if filter_col and filter_val is not None else None
    r = ac.compute_aggregate(rows, group_by, intent.get("value_column") or "銷售額", "sum", "bar",
        filters=filters)
    assert r, "alias 應對應 產品名稱->商品名稱"
    assert sum(r["data"]) == 1000


def test_product_with_comma():
    """輸入「momo, 深度保濕精華液的銷售額」時，應正規化為 momo深度保濕精華液"""
    USER_WITH_COMMA = "momo, 深度保濕精華液的銷售額"
    rows = ac.parse_csv_content(CSV)
    schema_summary = get_schema_summary(rows)
    intent = {"group_by_column": "平台", "value_column": "銷售金額", "filter_column": None, "filter_value": None}
    group_by, filter_col, filter_val = "平台", None, None
    if "的銷售額" in USER_WITH_COMMA:
        m = re.search(r"(.+?)的銷售額", USER_WITH_COMMA.strip())
        has_product_col = any(k in schema_summary for k in ("產品名稱", "產品", "商品名稱", "商品", "品名"))
        has_value_col = any(k in schema_summary for k in ("銷售金額", "銷售額", "銷售數量", "金額", "數量"))
        if m and has_product_col and has_value_col:
            inferred_product = re.sub(r"[\s,，、]+", "", m.group(1).strip())
            group_by = "產品名稱"
            filter_col = "產品名稱"
            filter_val = inferred_product
    assert filter_val == "momo深度保濕精華液", f"應正規化為 momo深度保濕精華液，實際 {filter_val}"
    r = ac.compute_aggregate(rows, group_by, "銷售金額", "sum", "bar",
        filters=[{"column": filter_col, "value": filter_val}])
    assert r and sum(r["data"]) == 1500


def test_momo_platform_product():
    """momo深度保濕精華液 = 平台 momo + 產品 深度保濕精華液"""
    csv = """平台,月份,產品名稱,銷售數量,銷售金額
momo,1月,momo深度保濕精華液,10,1000
momo,2月,深度保濕精華液,5,500
pchome,1月,深度保濕精華液,20,2000"""
    rows = ac.parse_csv_content(csv)
    r = ac.compute_aggregate(rows, "產品名稱", "銷售金額", "sum", "bar",
        filters=[{"column": "平台", "value": "momo"}, {"column": "產品名稱", "value": "深度保濕精華液"}])
    assert r, "應篩選 momo 平台"
    assert sum(r["data"]) == 1500, f"momo 平台應為 1500，實際 {sum(r['data'])}"


def test_indicator_margin_rate():
    """複合指標：毛利率 margin_rate = gross_profit / net_amount"""
    csv = """channel_id,net_amount,gross_profit
momo,1000,300
pchome,2000,600
shopee,500,100"""
    rows = ac.parse_csv_content(csv)
    assert rows and len(rows) == 3
    r = ac.compute_aggregate(
        rows,
        "channel_id",
        value_column=None,
        aggregation="sum",
        chart_type="bar",
        value_columns=["gross_profit", "net_amount"],
        indicator="margin_rate",
    )
    assert r, "indicator margin_rate 應成功"
    assert "labels" in r and "data" in r
    # momo: 300/1000=30%, pchome: 600/2000=30%, shopee: 100/500=20%
    data_by_label = dict(zip(r["labels"], r["data"]))
    assert data_by_label.get("momo") == 30.0
    assert data_by_label.get("pchome") == 30.0
    assert data_by_label.get("shopee") == 20.0


def test_indicator_no_group_by():
    """group_by_column=null 時，視為單一總計（如「momo 的毛利率」）"""
    csv = """channel_id,net_amount,gross_profit
momo,1000,300
momo,500,150"""
    rows = ac.parse_csv_content(csv)
    r = ac.compute_aggregate(
        rows,
        " ",  # 空 group_by
        value_column=None,
        aggregation="sum",
        chart_type="bar",
        value_columns=["gross_profit", "net_amount"],
        indicator="margin_rate",
        filters=[{"column": "channel_id", "value": "momo"}],
    )
    assert r, "group_by 空 + indicator 應成功"
    assert len(r["labels"]) == 3 and "毛利率" in r["labels"]
    idx = r["labels"].index("毛利率")
    assert r["data"][idx] == 30.0  # (300+150)/(1000+500)=30%


def test_no_value_column():
    """LLM 未輸出 value_column，補強應推斷"""
    intent = {
        "group_by_column": "平台",
        "value_column": None,  # 缺失
        "filter_column": None,
        "filter_value": None,
    }
    r = run_flow(intent)
    assert r, "補強應推斷 value_column=銷售金額"
    assert sum(r["data"]) == 1500


if __name__ == "__main__":
    test_wrong_intent_no_filter()
    print("OK: wrong intent (no filter) -> 補強成功")
    test_wrong_intent_wrong_group()
    print("OK: wrong intent (group_by=平台) -> 補強成功")
    test_correct_intent()
    print("OK: correct intent")
    test_no_value_column()
    print("OK: no value_column -> 補強成功")
    test_product_with_comma()
    print("OK: momo, 深度保濕精華液 正規化")
    test_momo_platform_product()
    print("OK: momo 平台 + 產品 雙重篩選")
    test_indicator_margin_rate()
    print("OK: indicator margin_rate")
    test_indicator_no_group_by()
    print("OK: indicator + group_by null")
    test_different_column_names()
    print("OK: 商品名稱/銷售額 alias 對應")
    print("All E2E tests passed.")
