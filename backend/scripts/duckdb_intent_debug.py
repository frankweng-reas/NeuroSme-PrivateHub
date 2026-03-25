#!/usr/bin/env python3
"""診斷 DuckDB 與 Intent：列數、日期／篩選欄位概況、可選執行 run_sql_compute_engine。

用法（於 backend/ 目錄）：
  PYTHONPATH=. python scripts/duckdb_intent_debug.py data/duckdb/90fd39d6-edcf-47b8-bac3-725dfe5a8817.duckdb
  PYTHONPATH=. python scripts/duckdb_intent_debug.py data/duckdb/xxx.duckdb --intent /path/to/intent.json

若未傳 schema，會以 data 表所有欄位建最小 schema（全部當 str）供 intent 通過欄位白名單。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import duckdb


def _minimal_schema_from_duckdb(con: duckdb.DuckDBPyConnection) -> dict:
    rows = con.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'data' ORDER BY ordinal_position").fetchall()
    cols = [r[0] for r in rows]
    return {"columns": {c: {"type": "str"} for c in cols}, "indicators": {}}


def main() -> int:
    ap = argparse.ArgumentParser(description="DuckDB + intent 診斷")
    ap.add_argument("duckdb_path", help=".duckdb 檔路徑（可相對於 backend/）")
    ap.add_argument("--intent", help="Intent JSON 檔路徑", default=None)
    ap.add_argument("--mark-col1-time", action="store_true", help="將 schema 的 col_1 標成 time（模擬 UI 日期欄）")
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    p = Path(args.duckdb_path)
    if not p.is_absolute():
        p = (root / p).resolve()
    if not p.is_file():
        print(f"找不到檔案: {p}", file=sys.stderr)
        return 1

    con = duckdb.connect(str(p), read_only=True)
    try:
        n = con.execute("SELECT COUNT(*) FROM data").fetchone()[0]
        print(f"[rows] {n}")
        print("[describe]")
        print(con.execute("DESCRIBE data").fetchdf().to_string())
        print("\n[col_1 min / max]")
        print(con.execute("SELECT MIN(col_1) AS mn, MAX(col_1) AS mx FROM data").fetchdf().to_string())
        print("\n[col_5 TOP]")
        print(con.execute("SELECT col_5, COUNT(*) c FROM data GROUP BY 1 ORDER BY c DESC LIMIT 15").fetchdf().to_string())
    finally:
        con.close()

    if args.intent:
        intent_path = Path(args.intent).expanduser()
        raw = json.loads(intent_path.read_text(encoding="utf-8"))
        con = duckdb.connect(str(p), read_only=True)
        try:
            schema = _minimal_schema_from_duckdb(con)
        finally:
            con.close()
        if args.mark_col1_time and "columns" in schema and "col_1" in schema["columns"]:
            schema["columns"]["col_1"] = {"type": "time", "attr": "dim_time"}
        print("\n[minimal schema keys]", list(schema.get("columns", {}).keys())[:20], "...")

        sys.path.insert(0, str(root))
        from app.services.compute_engine_sql import run_sql_compute_engine

        chart, err, dbg = run_sql_compute_engine(p, raw, schema)
        print("\n[run_sql_compute_engine]")
        print("error:", err)
        print("sql:", dbg.get("sql"))
        if chart:
            print("labels:", chart.get("labels"))
            print("datasets:", json.dumps(chart.get("datasets"), ensure_ascii=False, indent=2))
        else:
            print("debug:", json.dumps({k: v for k, v in dbg.items() if k != "sql"}, ensure_ascii=False, indent=2, default=str))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
