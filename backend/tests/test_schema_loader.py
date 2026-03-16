"""測試 schema_loader：載入 config/schemas/*.yaml"""
import sys

sys.path.insert(0, ".")
from app.services.schema_loader import load_schema


def test_load_schema_fact_business_operations():
    """fact_business_operations 應可載入且含 group_aliases、value_aliases"""
    s = load_schema("fact_business_operations")
    if s is None:
        try:
            import pytest
            pytest.skip("PyYAML 未安裝或 schema 檔不存在")
        except ImportError:
            return  # 無 pytest 時直接略過
    assert s.get("id") == "fact_business_operations"
    assert "group_aliases" in s
    assert "value_aliases" in s
    assert "平台" in s["group_aliases"]
    assert "channel_id" in s["group_aliases"]["平台"]
    assert "net_amount" in s["value_aliases"]["銷售金額"]


def test_load_schema_nonexistent():
    """不存在的 schema 應回傳 None"""
    s = load_schema("nonexistent_schema_xyz")
    assert s is None
