"""測試：momo深度保濕精華液的銷售額"""
import importlib.util
import sys

sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("ac", "app/services/analysis_compute.py")
ac = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ac)

CSV = """平台,月份,產品名稱,銷售數量,銷售金額
momo,1月,momo深度保濕精華液,10,1000
momo,2月,momo 深度保濕精華液,5,500
pchome,1月,其他產品,20,2000"""


def test_single_product():
    rows = ac.parse_csv_content(CSV)
    assert rows, "parse 失敗"
    assert len(rows) == 3

    r = ac.compute_aggregate(
        rows,
        "產品名稱",
        "銷售金額",
        "sum",
        "bar",
        filters=[{"column": "產品名稱", "value": "momo深度保濕精華液"}],
    )
    assert r, "compute 失敗"
    assert "labels" in r and "data" in r
    total = sum(r["data"])
    assert total == 1500, f"預期 1500，實際 {total}"
    print("OK: momo深度保濕精華液的銷售額 =", total)


if __name__ == "__main__":
    test_single_product()
