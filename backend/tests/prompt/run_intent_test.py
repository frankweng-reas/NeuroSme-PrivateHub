#!/usr/bin/env python3
"""
Intent Prompt 回歸測試腳本

執行方式（從 backend/ 目錄）：
  ./venv/bin/python tests/prompt/run_intent_test.py --save-baseline   # 初次建立 baseline
  ./venv/bin/python tests/prompt/run_intent_test.py                   # 比對 baseline
  ./venv/bin/python tests/prompt/run_intent_test.py --ids A1 B1 F1   # 只跑特定題號
  ./venv/bin/python tests/prompt/run_intent_test.py --model gemini/gemini-2.5-flash
  ./venv/bin/python tests/prompt/run_intent_test.py --model twcc/Llama3.3-FFM-70B-32K
  ./venv/bin/python tests/prompt/run_intent_test.py --verbose         # 失敗時顯示 LLM 原始輸出
  ./venv/bin/python tests/prompt/run_intent_test.py --prune-baseline  # 刪除 baseline/ 中已不在 cases.yaml 的 .json

Gemini／OpenAI：API Key 與產品相同，自 DB llm_provider_configs 讀取（需租戶）。
  --tenant-id <id> 或環境變數 INTENT_TEST_TENANT_ID，或 cases.yaml 的 tenant_id；
  若皆未設定，會依 schema 所屬 user_id 推斷租戶。
TWCC：仍使用環境變數 TWCC_API_KEY（與原腳本一致）。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import yaml

# ── 路徑設定：讓腳本從 tests/prompt/ 或 backend/ 都能執行 ──────────────────
_HERE = Path(__file__).resolve().parent
_BACKEND = _HERE.parent.parent          # backend/
_REPO = _BACKEND.parent                 # repo root
sys.path.insert(0, str(_BACKEND))

# 載入 .env（backend/.env）
from dotenv import load_dotenv
load_dotenv(_BACKEND / ".env")

# ── 現在才 import app 模組（需要 .env 先載入）─────────────────────────────
import litellm
from app.api.endpoints.chat import _get_llm_params, _get_provider_name
from app.core.database import SessionLocal
from app.models.bi_schema import BiSchema
from app.models.user import User
from app.services.schema_loader import load_schema_from_db
from app.api.endpoints.chat_compute_tool import (
    _extract_json_from_llm,
    _normalize_question_for_intent_extraction,
    _build_schema_block,
    _build_hierarchy_block,
)
from app.schemas.intent_v4 import IntentV4, auto_repair_intent
from pydantic import ValidationError

CASES_FILE = _HERE / "cases.yaml"
BASELINE_DIR = _HERE / "baseline"
BASELINE_DIR.mkdir(parents=True, exist_ok=True)

# ANSI 顏色
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
RESET = "\033[0m"
BOLD = "\033[1m"


def load_cases() -> dict:
    with open(CASES_FILE, encoding="utf-8") as f:
        return yaml.safe_load(f)


def resolve_intent_test_tenant_id(
    db,
    schema_id: str,
    *,
    cli_tenant: str | None,
    cases_config: dict,
) -> str | None:
    """
    優先順序：CLI --tenant-id → INTENT_TEST_TENANT_ID → cases.yaml tenant_id
    → bi_schemas.user_id 對應 users.tenant_id。
    """
    for raw in (cli_tenant, os.environ.get("INTENT_TEST_TENANT_ID"), cases_config.get("tenant_id")):
        if raw is None:
            continue
        s = str(raw).strip()
        if s:
            return s
    key = (schema_id or "").strip()
    if not key:
        return None
    row = db.query(BiSchema).filter(BiSchema.id == key).first()
    if not row or row.user_id is None:
        return None
    u = db.query(User).filter(User.id == row.user_id).first()
    if not u:
        return None
    return (u.tenant_id or "").strip() or None


def build_intent_prompt(schema_def: dict) -> str:
    """載入 intent system prompt（schema 已移至 user message）。"""
    base = _REPO / "config" / "system_prompt_analysis_intent_tool.md"
    return base.read_text(encoding="utf-8").strip()


def build_user_content(schema_def: dict, now_str: str, question: str) -> str:
    """組裝 user message：schema 在前，問題在後。"""
    schema_block = _build_schema_block(schema_def)
    hierarchy_block = _build_hierarchy_block(schema_def)
    return (
        f"# Data Schema\n{schema_block}\n\n"
        f"**層級** {hierarchy_block}\n\n"
        f"**輸出的每個 col_N 必須出現在上方 Data Schema 的 columns 清單中**\n\n"
        f"當前時間：{now_str}\n\n"
        f"問題: {_normalize_question_for_intent_extraction(question)}"
    )


def call_llm(
    model: str,
    system_prompt: str,
    user_content: str,
    *,
    db,
    tenant_id: str | None,
) -> str:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    if model.startswith("twcc/"):
        import urllib.request
        import urllib.error
        from app.api.endpoints.chat import _twcc_model_id

        api_key = os.environ.get("TWCC_API_KEY", "")
        api_base = os.environ.get("TWCC_API_BASE", "https://api-ams.twcc.ai/api/models/conversation")
        if not api_key:
            raise RuntimeError("TWCC_API_KEY 未設定，請在 backend/.env 中加入")

        model_id = _twcc_model_id(model[5:])
        payload = {
            "model": model_id,
            "messages": messages,
            "parameters": {
                "max_new_tokens": 2000,
                "temperature": 0.01,
                "top_k": 40,
                "top_p": 0.9,
                "frequency_penalty": 1.2,
            },
        }
        import json as _json
        body = _json.dumps(payload).encode()
        req = urllib.request.Request(
            api_base,
            data=body,
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                data = _json.loads(res.read().decode())
        except urllib.error.HTTPError as e:
            err_body = e.read().decode()
            raise RuntimeError(f"TWCC API 錯誤 {e.code}：{err_body}") from e
        return data.get("generated_text", "") or ""

    tid = (tenant_id or "").strip()
    if not tid:
        raise RuntimeError(
            "Gemini／OpenAI 須指定租戶以從 DB 讀取 API Key（與後台一致）。"
            "請使用 --tenant-id、環境變數 INTENT_TEST_TENANT_ID、在 cases.yaml 設定 tenant_id，"
            "或讓該 schema 的 bi_schemas.user_id 可對應到 users.tenant_id。"
        )
    litellm_model, api_key, api_base = _get_llm_params(model, db=db, tenant_id=tid)
    if not api_key:
        raise RuntimeError(
            f"租戶 {tid!r} 未設定 {_get_provider_name(model)} 的 API Key（llm_provider_configs.is_active）。"
            "請在管理介面設定後再跑測試。"
        )
    if model.startswith("gemini/"):
        os.environ["GEMINI_API_KEY"] = api_key
    else:
        os.environ["OPENAI_API_KEY"] = api_key

    completion_kwargs: dict = {
        "model": litellm_model,
        "messages": messages,
        "api_key": api_key,
        "temperature": 0,
        "timeout": 120,
    }
    if api_base:
        base = (api_base or "").rstrip("/")
        completion_kwargs["api_base"] = base if base.endswith("/v1") else f"{base}/v1"

    resp = litellm.completion(**completion_kwargs)
    return resp.choices[0].message.content or ""  # type: ignore[union-attr]


def validate_intent(raw_output: str) -> tuple[dict | None, str | None]:
    """
    回傳 (intent_dict, error_message)。
    intent_dict 為通過 Pydantic 驗證後的 dict；失敗時為 None。
    """
    intent = _extract_json_from_llm(raw_output)
    if not intent:
        return None, "無法從 LLM 輸出萃取 JSON"
    intent = auto_repair_intent(intent)
    try:
        IntentV4.model_validate(intent)
        return intent, None
    except ValidationError as e:
        first_err = e.errors()[0]
        loc = " → ".join(str(x) for x in first_err.get("loc", []))
        msg = first_err.get("msg", "")
        return None, f"{loc}：{msg}" if loc else msg


def prune_baselines_not_in_cases(case_ids: set[str]) -> list[str]:
    """刪除 baseline 目錄下 stem 不在 case_ids 的 .json，回傳已刪檔名。"""
    removed: list[str] = []
    for path in sorted(BASELINE_DIR.glob("*.json")):
        if path.stem not in case_ids:
            path.unlink()
            removed.append(path.name)
    return removed


def load_baseline(case_id: str) -> dict | None:
    path = BASELINE_DIR / f"{case_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_baseline(case_id: str, intent: dict) -> None:
    path = BASELINE_DIR / f"{case_id}.json"
    path.write_text(json.dumps(intent, ensure_ascii=False, indent=2), encoding="utf-8")


def _normalize_for_compare(intent: dict) -> dict:
    """
    比對前正規化：移除 metrics 的 label/alias（允許自由命名，不影響功能）。
    post_process 中引用 alias 的欄位同步改為 metric id，避免誤報。
    """
    import copy
    d = copy.deepcopy(intent)
    # alias → id 對照表
    alias_to_id: dict[str, str] = {}
    for m in d.get("metrics", []):
        if "alias" in m and "id" in m:
            alias_to_id[m["alias"]] = m["id"]
    # 移除 label、alias
    for m in d.get("metrics", []):
        m.pop("label", None)
        m.pop("alias", None)
    # post_process 裡的 alias 引用 → 換成 metric id
    pp = d.get("post_process") or {}
    if pp.get("where") and pp["where"].get("col") in alias_to_id:
        pp["where"]["col"] = alias_to_id[pp["where"]["col"]]
    for s in pp.get("sort", []):
        if s.get("col") in alias_to_id:
            s["col"] = alias_to_id[s["col"]]
    return d


def diff_summary(old: dict, new: dict) -> list[str]:
    """簡單的一層 key diff，回傳有差異的說明。label/alias 已在呼叫前正規化。"""
    diffs = []
    all_keys = set(old) | set(new)
    for k in sorted(all_keys):
        ov, nv = old.get(k), new.get(k)
        if ov != nv:
            diffs.append(f"  [{k}] {ov!r} → {nv!r}")
    return diffs


def run(
    save_baseline_mode: bool = False,
    filter_ids: list[str] | None = None,
    model_override: str | None = None,
    verbose: bool = False,
    tenant_id_cli: str | None = None,
) -> None:
    config = load_cases()
    schema_id = config["schema_id"]
    model = model_override or config.get("model", "gpt-4o-mini")
    cases = config["cases"]

    if filter_ids:
        cases = [c for c in cases if c["id"] in filter_ids]
        if not cases:
            print(f"找不到指定 ids：{filter_ids}")
            sys.exit(1)

    print(f"\n{BOLD}Intent Prompt 回歸測試{RESET}")
    print(f"schema_id : {schema_id}")
    print(f"model     : {model}")
    print(f"模式      : {'【儲存 baseline】' if save_baseline_mode else '【比對 baseline】'}")
    print(f"題數      : {len(cases)}")
    print(f"時間      : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("─" * 60)

    db = SessionLocal()
    try:
        schema_def = load_schema_from_db(schema_id, db)
        if not schema_def:
            print(f"{RED}無法載入 schema（id={schema_id}），請確認 DB 連線與 schema_id。{RESET}")
            sys.exit(1)

        resolved_schema_pk = str(schema_def.get("id") or schema_id).strip()
        intent_tenant = resolve_intent_test_tenant_id(
            db, resolved_schema_pk, cli_tenant=tenant_id_cli, cases_config=config
        )
        if not model.startswith("twcc/"):
            if not intent_tenant:
                print(
                    f"{RED}無法解析租戶（Gemini/OpenAI 需從 DB 讀取 API Key）。"
                    f"請使用 --tenant-id、INTENT_TEST_TENANT_ID、cases.yaml tenant_id，"
                    f"或為 schema 設定 bi_schemas.user_id。{RESET}"
                )
                sys.exit(1)
            print(f"tenant_id : {intent_tenant}（與後台 llm_provider_configs 一致）")

        intent_prompt = build_intent_prompt(schema_def)
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

        results = {"pass": [], "warn": [], "fail": [], "new": []}

        for case in cases:
            cid = case["id"]
            label = case["label"]
            question = case["question"]
            user_content = build_user_content(schema_def, now_str, question)

            sys.stdout.write(f"  {cid} {label} ... ")
            sys.stdout.flush()

            try:
                raw = call_llm(
                    model,
                    intent_prompt,
                    user_content,
                    db=db,
                    tenant_id=intent_tenant if not model.startswith("twcc/") else None,
                )
            except Exception as e:
                print(f"{RED}❌ LLM 呼叫失敗：{e}{RESET}")
                results["fail"].append((cid, label, f"LLM 呼叫失敗：{e}"))
                continue

            intent, err = validate_intent(raw)

            if err:
                print(f"{RED}❌ 驗證失敗{RESET}")
                print(f"     原因：{err}")
                if verbose:
                    print(f"     LLM 輸出：{raw[:300]}")
                results["fail"].append((cid, label, err))
                continue

            if save_baseline_mode:
                assert intent is not None
                save_baseline(cid, intent)
                print(f"{GREEN}✅ 已儲存 baseline{RESET}")
                results["new"].append((cid, label))
                continue

            baseline = load_baseline(cid)
            if baseline is None:
                print(f"{YELLOW}⚠️  無 baseline（請先執行 --save-baseline）{RESET}")
                results["warn"].append((cid, label, "無 baseline"))
                continue

            assert intent is not None
            diffs = diff_summary(
                _normalize_for_compare(baseline),
                _normalize_for_compare(intent),
            )
            if not diffs:
                print(f"{GREEN}✅ 通過{RESET}")
                results["pass"].append((cid, label))
            else:
                print(f"{YELLOW}⚠️  輸出有變動{RESET}")
                for d in diffs:
                    print(d)
                results["warn"].append((cid, label, f"{len(diffs)} 個欄位變動"))
    finally:
        db.close()

    # ── 報告 ────────────────────────────────────────────────────────────────
    total = len(cases)
    print("\n" + "─" * 60)
    print(f"{BOLD}測試結果{RESET}")
    print(f"  ✅ 通過      : {len(results['pass'])}")
    print(f"  ⚠️  有變動    : {len(results['warn'])}")
    print(f"  ❌ 驗證失敗  : {len(results['fail'])}")
    if save_baseline_mode:
        print(f"  💾 儲存 baseline : {len(results['new'])}")
    print(f"  總計        : {total}")

    if results["fail"]:
        print(f"\n{RED}驗證失敗題目：{RESET}")
        for cid, label, reason in results["fail"]:
            print(f"  {cid} {label}：{reason}")

    if results["warn"] and not save_baseline_mode:
        print(f"\n{YELLOW}有變動題目（請人工確認是改善還是退步）：{RESET}")
        for cid, label, reason in results["warn"]:
            print(f"  {cid} {label}：{reason}")

    print()
    if results["fail"]:
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Intent Prompt 回歸測試")
    parser.add_argument(
        "--save-baseline",
        action="store_true",
        help="儲存目前 LLM 輸出為 baseline（prompt 穩定時執行）",
    )
    parser.add_argument(
        "--ids",
        nargs="+",
        metavar="ID",
        help="只跑指定題號，如 A1 B1 F1",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="覆寫 model，如 gemini/gemini-2.5-flash",
    )
    parser.add_argument(
        "--tenant-id",
        default=None,
        metavar="ID",
        help="租戶 id（ Gemini/OpenAI 時從 DB 讀 API Key；優先於 INTENT_TEST_TENANT_ID 與 cases.yaml）",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="失敗時顯示 LLM 原始輸出",
    )
    parser.add_argument(
        "--prune-baseline",
        action="store_true",
        help="刪除 baseline/ 內已不在目前 cases.yaml 的題目檔案，然後結束（不跑 LLM）",
    )
    args = parser.parse_args()
    if args.prune_baseline:
        config = load_cases()
        case_ids = {c["id"] for c in config["cases"]}
        removed = prune_baselines_not_in_cases(case_ids)
        if removed:
            print(f"已移除過舊 baseline：{', '.join(removed)}")
        else:
            print("無需移除的 baseline（皆仍在 cases.yaml）")
        raise SystemExit(0)

    run(
        save_baseline_mode=args.save_baseline,
        filter_ids=args.ids,
        model_override=args.model,
        verbose=args.verbose,
        tenant_id_cli=args.tenant_id,
    )
