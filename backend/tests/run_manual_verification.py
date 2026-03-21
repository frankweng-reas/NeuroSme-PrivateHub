#!/usr/bin/env python3
"""
手動驗證腳本：使用固定資料執行測試案例，輸出實際結果與預期值供比對。
執行：cd backend && python tests/run_manual_verification.py
"""
import sys
sys.path.insert(0, ".")
import importlib.util
spec = importlib.util.spec_from_file_location("ac", "app/services/analysis_compute.py")
ac = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ac)

CSV = """store_name,channel,item_name,gross_profit,sales_amount,cost_amount,quantity
店A,momo,商品X,100,200,50,10
店A,momo,商品Y,50,100,25,5
店A,shopee,商品X,80,160,40,8
店B,momo,商品X,200,400,100,20
店B,shopee,商品Y,30,60,15,3
店C,momo,商品X,40,200,40,20"""

rows = ac.parse_csv_content(CSV)
if not rows:
    print("ERROR: 無法解析 CSV")
    sys.exit(1)

def run_case(name, **kwargs):
    print(f"\n{'='*60}\n【{name}】\n{'='*60}")
    r = ac.compute_aggregate(rows, **kwargs)
    if not r:
        print("結果：None（失敗）")
        return
    print("labels:", r.get("labels"))
    if "datasets" in r:
        for d in r.get("datasets", []):
            print(f"  {d.get('label')}: {d.get('data')}")
    if "data" in r:
        print("data:", r.get("data"))
    return r

# 案例 1
run_case("案例 1：各店銷售額、毛利率、ROI",
    group_by_column="store_name",
    value_columns=[
        {"column": "gross_profit", "aggregation": "sum"},
        {"column": "sales_amount", "aggregation": "sum"},
        {"column": "cost_amount", "aggregation": "sum"},
    ],
    chart_type="bar",
    indicator=["margin_rate", "roi"],
    display_fields=["store_name", "sales_amount", "margin_rate", "roi"],
)
print("\n預期：銷售金額=[460,460,200], 毛利率=[50,50,20], ROI=[2,2,1]（labels 順序可能為店A,店B,店C）")

# 案例 2
run_case("案例 2：各店毛利率",
    group_by_column="store_name",
    value_columns=[
        {"column": "gross_profit", "aggregation": "sum"},
        {"column": "sales_amount", "aggregation": "sum"},
    ],
    chart_type="bar",
    indicator="margin_rate",
    display_fields=["store_name", "margin_rate"],
)
print("\n預期：毛利率=[50,50,20]")

# 案例 3
run_case("案例 3：總計毛利率與 ROI",
    group_by_column=" ",
    value_columns=[
        {"column": "gross_profit", "aggregation": "sum"},
        {"column": "sales_amount", "aggregation": "sum"},
        {"column": "cost_amount", "aggregation": "sum"},
    ],
    chart_type="bar",
    indicator=["margin_rate", "roi"],
)
print("\n預期：銷售金額=1120, 毛利=500, 成本=270, 毛利率≈44.64, ROI≈1.85")

# 案例 4
run_case("案例 4：各店各通路銷售額",
    group_by_column="store_name",
    series_by_column="channel",
    value_columns=[{"column": "sales_amount", "aggregation": "sum"}],
    chart_type="bar",
    display_fields=["sales_amount"],
)
print("\n預期：銷售金額-momo=[300,400,200], 銷售金額-shopee=[160,60,0]")

# 案例 5
run_case("案例 5：各店銷售額與成本",
    group_by_column="store_name",
    value_columns=[
        {"column": "sales_amount", "aggregation": "sum"},
        {"column": "cost_amount", "aggregation": "sum"},
    ],
    chart_type="bar",
    display_fields=["sales_amount", "cost_amount"],
)
print("\n預期：銷售金額=[460,460,200], 成本=[115,115,40]")

# 案例 6
run_case("案例 6：總計多欄位",
    group_by_column=" ",
    value_columns=[
        {"column": "sales_amount", "aggregation": "sum"},
        {"column": "cost_amount", "aggregation": "sum"},
        {"column": "gross_profit", "aggregation": "sum"},
    ],
    chart_type="bar",
)
print("\n預期：銷售金額=1120, 成本=270, 毛利=500")

print("\n" + "="*60)
print("請對照 test_compute_manual_verification.md 中的預期值驗證上述結果")
print("="*60)
