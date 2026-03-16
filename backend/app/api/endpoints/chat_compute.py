"""Chat Compute API：POST /chat/completions-compute。LLM 生成 SQL → DuckDB 執行 → 文字生成"""
import json
import logging
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Annotated, Any

import litellm
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from uuid import UUID

from app.api.endpoints.chat import (
    ChatRequest,
    _check_agent_access,
    _get_bi_sources_content,
    _get_llm_params,
    _get_provider_name,
    _twcc_model_id,
)
from app.core.database import get_db
from app.models.bi_project import BiProject
from app.core.security import get_current_user
from app.models.user import User
from app.services.analysis_duckdb import (
    debug_sql_matching_rows,
    execute_sql_to_chart,
    get_schema_summary as get_schema_summary_duckdb,
    get_schema_summary_from_path,
    get_sql_result,
    parse_csv_to_df,
)
from app.services.duckdb_store import get_project_duckdb_path

router = APIRouter()
logger = logging.getLogger(__name__)

_PROMPT_FILES = {
    "sql": "system_prompt_analysis_sql.md",
    "text": "system_prompt_analysis_text.md",
}


def _load_prompt(prompt_key: str) -> str:
    base = Path(__file__).resolve().parents[3]
    filename = _PROMPT_FILES.get(prompt_key, "")
    for root in (base.parent / "config", base / "config"):
        path = root / filename
        if path.exists():
            try:
                return path.read_text(encoding="utf-8").strip()
            except (OSError, IOError) as e:
                logger.debug("讀取 %s 失敗: %s", filename, e)
    return ""


def _extract_and_merge_csv_blocks(raw: str) -> str:
    """從 bi_sources 拼接字串中取出所有 CSV 區塊並合併（同 schema 時合併資料列）"""
    if not raw or not raw.strip():
        return ""
    # 格式：--- 檔名：xxx ---\ncontent
    parts = re.split(r"---\s*檔名：.*?---\s*\n", raw, flags=re.IGNORECASE)
    blocks: list[str] = []
    for p in parts:
        p = p.strip()
        if not p or ("," not in p and "\t" not in p):
            continue
        blocks.append(p)
    if not blocks:
        return raw.strip()
    if len(blocks) == 1:
        return blocks[0]
    # 合併多個 CSV：取第一塊的 header，其餘塊只取 data 列（跳過 header）
    lines0 = blocks[0].split("\n")
    if not lines0:
        return blocks[0]
    header = lines0[0]
    merged_rows = [header]
    for block in blocks:
        lines = block.split("\n")
        if len(lines) < 2:
            continue
        # 若與第一塊 header 相同，跳過 header 只加 data
        if lines[0].strip().lower() == header.strip().lower():
            merged_rows.extend(lines[1:])
        else:
            merged_rows.extend(lines)
    return "\n".join(merged_rows)


def _infer_chart_type(question: str) -> str:
    """依問題內容推斷 chart_type"""
    q = (question or "").strip().lower()
    if any(kw in q for kw in ("佔比", "比例", "份額")):
        return "pie"
    if any(kw in q for kw in ("趨勢", "變化", "月", "季", "年")):
        return "line"
    return "bar"


def _extract_json_from_llm(raw: str) -> dict | None:
    """從 LLM 回覆中萃取 JSON"""
    if not raw or not raw.strip():
        return None
    text = raw.strip()
    # 找第一個 { 到對應 } 的區塊
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    pass
                break
    if text.startswith("{"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    return None


def _llm_data_to_chart(d: dict[str, Any], fallback: dict[str, Any] | None) -> dict[str, Any] | None:
    """將 LLM 的 data 格式轉成 chart_data 格式。失敗時回傳 fallback。"""
    if not isinstance(d, dict):
        return fallback
    t = (d.get("type") or "").lower()
    labels = d.get("labels")
    if not isinstance(labels, list) or not labels:
        return fallback

    if t == "pie":
        values = d.get("values")
        if not isinstance(values, list) or len(values) != len(labels):
            return fallback
        return {
            "labels": [str(x) for x in labels],
            "data": [float(x) if isinstance(x, (int, float)) else 0 for x in values],
            "chartType": "pie",
            "title": d.get("title"),
        }

    if t in ("bar", "line"):
        datasets = d.get("datasets")
        if not isinstance(datasets, list) or not datasets:
            return fallback
        out_datasets = []
        for ds in datasets:
            if not isinstance(ds, dict):
                continue
            vals = ds.get("values")
            if not isinstance(vals, list) or len(vals) != len(labels):
                continue
            out_datasets.append({
                "label": str(ds.get("label", "")),
                "data": [float(x) if isinstance(x, (int, float)) else 0 for x in vals],
            })
        if not out_datasets:
            return fallback
        return {
            "labels": [str(x) for x in labels],
            "datasets": out_datasets,
            "chartType": t,
            "title": d.get("title"),
            "yAxisLabel": d.get("yAxisLabel"),
            "valueSuffix": d.get("valueSuffix"),
        }

    return fallback


class ChatResponseCompute(BaseModel):
    content: str
    model: str = ""
    usage: dict[str, int] | None = None
    chart_data: dict[str, Any] | None = None
    debug: dict[str, Any] | None = None


async def _call_llm(
    model: str,
    system_prompt: str,
    user_content: str,
) -> tuple[str, dict | None]:
    """呼叫 LLM，回傳 (content, usage)"""
    litellm_model, api_key, api_base = _get_llm_params(model)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=f"{_get_provider_name(model)} API Key 未設定",
        )
    if model.startswith("twcc/") and not api_base:
        raise HTTPException(status_code=503, detail="台智雲 TWCC_API_BASE 未設定")

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    if model.startswith("twcc/"):
        import aiohttp
        url = (api_base or "").rstrip("/")
        model_id = _twcc_model_id(model[5:])
        payload = {
            "model": model_id,
            "messages": messages,
            "parameters": {"max_new_tokens": 2000, "temperature": 0},
        }
        headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
        timeout = aiohttp.ClientTimeout(total=60)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                resp.raise_for_status()
                data = await resp.json()
        content = data.get("generated_text", "") or ""
        usage = {
            "prompt_tokens": data.get("prompt_tokens", 0),
            "completion_tokens": data.get("generated_tokens", data.get("completion_tokens", 0)),
            "total_tokens": data.get("total_tokens", 0),
        }
        return content, usage

    if model.startswith("gemini/"):
        os.environ["GEMINI_API_KEY"] = api_key
    else:
        os.environ["OPENAI_API_KEY"] = api_key

    completion_kwargs: dict = {
        "model": litellm_model,
        "messages": messages,
        "api_key": api_key,
        "timeout": 60,
        "temperature": 0,
    }
    if api_base:
        base = api_base.rstrip("/")
        completion_kwargs["api_base"] = base if base.endswith("/v1") else f"{base}/v1"

    resp = await litellm.acompletion(**completion_kwargs)
    content = (resp.choices[0].message.content or "") if resp.choices else ""
    usage = None
    if resp.usage:
        usage = {
            "prompt_tokens": resp.usage.prompt_tokens,
            "completion_tokens": resp.usage.completion_tokens,
            "total_tokens": resp.usage.total_tokens,
        }
    return content, usage


@router.post("/completions-compute", response_model=ChatResponseCompute)
async def chat_completions_compute(
    req: ChatRequest,
    db: Annotated[Session, Depends(get_db)] = ...,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """LLM 生成 SQL → DuckDB 執行 → 文字生成。需 project_id 且為 bi_project。"""
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required（compute flow 僅支援 BI 專案）")

    try:
        tenant_id, _ = _check_agent_access(db, current, req.agent_id.strip())
    except HTTPException:
        raise

    try:
        uuid_pid = UUID(pid)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id 格式錯誤")

    proj = db.query(BiProject).filter(BiProject.project_id == uuid_pid).first()
    if not proj or proj.user_id != str(current.id):
        raise HTTPException(status_code=404, detail="專案不存在或無權限")

    raw_data = _get_bi_sources_content(db, current.id, pid)
    if not raw_data or not raw_data.strip():
        raise HTTPException(status_code=400, detail="請先上傳並選用 CSV 來源檔案")

    duckdb_path = get_project_duckdb_path(pid)
    df: Any = None
    if duckdb_path:
        schema_summary = get_schema_summary_from_path(duckdb_path)
        logger.info("DuckDB 長存: %s", duckdb_path)
    else:
        csv_block = _extract_and_merge_csv_blocks(raw_data)
        df = parse_csv_to_df(csv_block)
        if df is None or df.empty:
            raise HTTPException(status_code=400, detail="無法解析 CSV 資料，請確認格式正確")
        logger.info("DuckDB 載入 %d 列，欄位: %s", len(df), list(df.columns))
        schema_summary = get_schema_summary_duckdb(df)
    model = (req.model or "").strip() or "gpt-4o-mini"
    row_count = len(df) if df is not None and not df.empty else (0 if not duckdb_path else None)
    debug: dict[str, Any] = {"schema_summary": schema_summary, "row_count": row_count}
    chart_result: dict[str, Any] | None = None
    usage1: dict | None = None

    sql_prompt = _load_prompt("sql")
    if not sql_prompt:
        raise HTTPException(status_code=500, detail="SQL prompt 檔案不存在 (system_prompt_analysis_sql.md)")

    user_content_sql = f"""schema:\n{schema_summary}\n\n問題: {req.content}"""
    try:
        sql_raw, usage1 = await _call_llm(model, sql_prompt, user_content_sql)
    except Exception as e:
        logger.exception("SQL 生成 LLM 呼叫失敗")
        raise HTTPException(status_code=500, detail=f"SQL 生成失敗：{e}")

    debug["sql_raw"] = sql_raw
    debug["sql_usage"] = usage1
    sql_intent = _extract_json_from_llm(sql_raw)
    if not sql_intent or not sql_intent.get("sql"):
        return ChatResponseCompute(
            content="無法從 LLM 回覆解析出 SQL。請確認 prompt 與 schema。",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    sql_stmt = sql_intent.get("sql", "").strip()
    chart_type = _infer_chart_type(req.content)
    value_suffix = "元"
    chart_result = execute_sql_to_chart(
        df, sql_stmt, chart_type=chart_type, as_pie_percent=(chart_type == "pie"),
        duckdb_path=duckdb_path,
    )
    debug_sql_matching_rows(df, sql_stmt, duckdb_path=duckdb_path)
    if chart_result:
        if value_suffix:
            chart_result["valueSuffix"] = value_suffix
        debug["sql_intent"] = sql_intent
        debug["flow"] = "duckdb"

    debug["chart_result"] = chart_result
    debug["sql_result"] = get_sql_result(df, sql_stmt, duckdb_path=duckdb_path)

    if not chart_result:
        return ChatResponseCompute(
            content="DuckDB SQL 執行失敗或結果為空。請確認 schema 與問題描述，或檢查 debug 中的 sql_raw。",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    text_prompt = _load_prompt("text")
    if not text_prompt:
        text_prompt = "根據計算結果撰寫分析文字，使用 Markdown 格式。"

    # 將 labels + data 轉成明確的「類別 = 數值」格式，減少 LLM 配對錯誤
    # 優先從 sql_result 取，確保產品名稱等類別不會遺失
    detail_lines: list[str] = []
    sql_rows = debug.get("sql_result") or []
    if sql_rows:
        cols = list(sql_rows[0].keys())
        if chart_type == "pie":
            for row in sql_rows:
                items = [(k, v) for k, v in row.items()]
                if len(items) >= 2:
                    lbl = items[0][1]
                    val = items[1][1]
                    if isinstance(val, (int, float)) and val is not None:
                        line = f"  {lbl} = {val}"
                        if len(items) >= 3 and "佔比" in str(items[2][0]):
                            pct = items[2][1]
                            if isinstance(pct, (int, float)) and pct is not None:
                                line += f" (佔比 {pct}%)"
                        detail_lines.append(line)
        elif len(cols) >= 3:
            pivot: dict[str, list[tuple[str, float]]] = defaultdict(list)
            for row in sql_rows:
                k0 = str(row.get(cols[0], ""))
                k1 = str(row.get(cols[1], ""))
                v = row.get(cols[2])
                if isinstance(v, (int, float)) and v is not None:
                    pivot[k0].append((k1, float(v)))
            for x_label in sorted(pivot.keys()):
                parts = [f"{name} {int(v) if v == int(v) else v}" for name, v in pivot[x_label]]
                detail_lines.append(f"  {x_label}: " + ", ".join(parts))
        elif len(cols) == 2:
            for row in sql_rows:
                lbl = row.get(cols[0], "")
                val = row.get(cols[1])
                if isinstance(val, (int, float)) and val is not None:
                    detail_lines.append(f"  {lbl} = {val}")
    if not detail_lines:
        return ChatResponseCompute(
            content="無法格式化計算結果（SQL 回傳格式不符合預期）。請調整問題或檢查 schema。",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    detail_block = "計算結果：\n" + "\n".join(detail_lines)
    user_content_text = f"""使用者問題：{req.content}

{detail_block}

請撰寫分析文字，金額與數字必須與上述完全一致。"""

    try:
        text_content, usage2 = await _call_llm(model, text_prompt, user_content_text)
    except Exception as e:
        logger.exception("文字生成 LLM 呼叫失敗")
        return ChatResponseCompute(
            content=f"文字生成失敗：{e}",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    debug["text_usage"] = usage2

    # 解析 LLM 回覆：若為 JSON（含 text + data），用其 text 與 data；否則用原始回覆，圖表僅來自 LLM 的 data
    final_content = text_content.strip()
    final_chart: dict[str, Any] | None = None
    parsed = _extract_json_from_llm(text_content)
    if parsed and isinstance(parsed.get("text"), str) and parsed.get("data") is not None:
        final_content = parsed["text"].strip()
        d = parsed["data"]
        if isinstance(d, dict):
            converted = _llm_data_to_chart(d, None)
            if converted:
                final_chart = converted

    total_usage = usage1 or {}
    if usage2:
        for k, v in usage2.items():
            total_usage[k] = total_usage.get(k, 0) + v

    return ChatResponseCompute(
        content=final_content,
        model=model,
        usage=total_usage,
        chart_data=final_chart,
        debug=debug,
    )
