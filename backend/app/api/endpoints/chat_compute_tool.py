"""Chat Compute Tool API：POST /chat/completions-compute-tool。LLM 意圖萃取 → Backend 計算 → 文字生成

全新 Tool Calling 路徑：不產生 SQL，LLM 只輸出結構化 JSON，計算由 analysis_compute 負責。
"""
import json
import logging
import os
import re
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
from app.services.analysis_compute import (
    compute_aggregate,
    get_schema_summary,
    parse_csv_content,
)
from app.services.duckdb_store import execute_sql_on_duckdb_file, get_project_duckdb_path
from app.services.schema_loader import load_schema

router = APIRouter()
logger = logging.getLogger(__name__)

# 複合指標預設 value_columns（LLM 未輸出時補強）
_INDICATOR_DEFAULT_VALUE_COLUMNS: dict[str, list[str]] = {
    "margin_rate": ["gross_profit", "net_amount"],
    "roi": ["gross_profit", "cost_amount"],
    "arpu": ["net_amount", "quantity"],
    "discount_rate": ["discount_amount", "net_amount"],
}

def _parse_filters_from_intent(intent: dict[str, Any]) -> list[dict[str, Any]] | None:
    """從 intent 解析 filters。支援 filters 陣列；無則由 filter_column/filter_value 轉換。"""
    filters = intent.get("filters")
    if isinstance(filters, list):
        out = []
        for f in filters:
            if isinstance(f, dict):
                col = f.get("column")
                val = f.get("value")
                if col is not None:
                    out.append({"column": str(col).strip(), "value": val})
        if out:
            return out
    fc, fv = intent.get("filter_column"), intent.get("filter_value")
    if fc and isinstance(fc, str) and fv is not None:
        return [{"column": fc.strip(), "value": fv}]
    return None


_PROMPT_FILES = {
    "intent": "system_prompt_analysis_intent_tool.md",
    "text": "system_prompt_analysis_text_tool.md",
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


def _infer_chart_type(question: str) -> str:
    """依問題內容推斷 chart_type（pie/line/bar）。意圖層不處理 chart，由後端推斷。"""
    q = (question or "").strip().lower()
    if any(kw in q for kw in ("佔比", "比例", "份額")):
        return "pie"
    if any(kw in q for kw in ("趨勢", "變化", "月", "季", "年")):
        return "line"
    return "bar"


def _extract_and_merge_csv_blocks(raw: str) -> str:
    """從 bi_sources 拼接字串中取出所有 CSV 區塊並合併（同 schema 時合併資料列）"""
    if not raw or not raw.strip():
        return ""
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
    lines0 = blocks[0].split("\n")
    if not lines0:
        return blocks[0]
    header = lines0[0]
    merged_rows = [header]
    for block in blocks:
        lines = block.split("\n")
        if len(lines) < 2:
            continue
        if lines[0].strip().lower() == header.strip().lower():
            merged_rows.extend(lines[1:])
        else:
            merged_rows.extend(lines)
    return "\n".join(merged_rows)


def _extract_json_from_llm(raw: str) -> dict | None:
    """從 LLM 回覆中萃取 JSON"""
    if not raw or not raw.strip():
        return None
    text = raw.strip()
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


def _chart_result_to_detail_lines(chart_result: dict[str, Any]) -> list[str]:
    """將 compute_aggregate 的 chart_result 轉為給 LLM 的「類別 = 數值」格式"""
    detail_lines: list[str] = []
    labels = chart_result.get("labels")
    if not isinstance(labels, list) or not labels:
        return detail_lines

    datasets = chart_result.get("datasets")
    if datasets and isinstance(datasets, list) and len(datasets) > 0:
        for i, x_label in enumerate(labels):
            parts = []
            for ds in datasets:
                if isinstance(ds, dict):
                    lbl = ds.get("label", "")
                    data = ds.get("data")
                    if isinstance(data, list) and i < len(data):
                        v = data[i]
                        parts.append(f"{lbl} {int(v) if isinstance(v, (int, float)) and v == int(v) else v}")
            if parts:
                detail_lines.append(f"  {x_label}: " + ", ".join(parts))
    else:
        data = chart_result.get("data")
        if isinstance(data, list) and len(data) == len(labels):
            for i, lbl in enumerate(labels):
                v = data[i]
                detail_lines.append(f"  {lbl} = {int(v) if isinstance(v, (int, float)) and v == int(v) else v}")
    return detail_lines


class ChatResponseComputeTool(BaseModel):
    content: str
    model: str = ""
    usage: dict[str, int] | None = None
    chart_data: dict[str, Any] | None = None
    debug: dict[str, Any] | None = None


class IntentToComputeRequest(BaseModel):
    """dev-test-intent-to-data 專用：直接傳入 intent JSON 呼叫 compute_aggregate"""
    agent_id: str
    project_id: str
    intent: dict[str, Any]


class IntentToComputeRawRequest(BaseModel):
    """dev-test-intent-to-data 專用：傳入 intent + rows，無需 agent/project"""
    intent: dict[str, Any]
    rows: list[dict[str, Any]]


class IntentToComputeByProjectRequest(BaseModel):
    """dev-test-intent-to-data 專用：僅需 project_id，從 DuckDB 載入資料"""
    project_id: str
    intent: dict[str, Any]


class IntentToComputeResponse(BaseModel):
    chart_result: dict[str, Any] | None


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


@router.post("/completions-compute-tool", response_model=ChatResponseComputeTool)
async def chat_completions_compute_tool(
    req: ChatRequest,
    db: Annotated[Session, Depends(get_db)] = ...,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """Tool Calling 路徑：LLM 意圖萃取 → Backend 計算 → 文字生成。需 project_id 且為 bi_project。"""
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required（compute flow 僅支援 BI 專案）")

    try:
        _check_agent_access(db, current, req.agent_id.strip())
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

    csv_block = _extract_and_merge_csv_blocks(raw_data)
    rows = parse_csv_content(csv_block)
    if not rows:
        raise HTTPException(status_code=400, detail="無法解析 CSV 資料，請確認格式正確")
    logger.info("Tool flow 載入 %d 列，欄位: %s", len(rows), list(rows[0].keys()) if rows else [])

    schema_id = (proj.schema_id or "").strip() or "fact_business_operations"
    schema_def = load_schema(schema_id)
    if not schema_def:
        schema_def = load_schema("fact_business_operations")
    schema_summary = get_schema_summary(rows, schema_def)
    model = (req.model or "").strip() or "gpt-4o-mini"
    debug: dict[str, Any] = {"schema_summary": schema_summary, "row_count": len(rows)}
    chart_result: dict[str, Any] | None = None
    usage1: dict | None = None

    intent_prompt = _load_prompt("intent")
    if not intent_prompt:
        raise HTTPException(status_code=500, detail="Intent prompt 檔案不存在 (system_prompt_analysis_intent_tool.md)")

    user_content_intent = f"""schema:\n{schema_summary}\n\n問題: {req.content}"""
    try:
        intent_raw, usage1 = await _call_llm(model, intent_prompt, user_content_intent)
    except Exception as e:
        logger.exception("意圖萃取 LLM 呼叫失敗")
        raise HTTPException(status_code=500, detail=f"意圖萃取失敗：{e}")

    debug["intent_raw"] = intent_raw
    debug["intent_usage"] = usage1
    intent = _extract_json_from_llm(intent_raw)
    has_aggregate = intent.get("value_column") or intent.get("value_columns") or intent.get("indicator")
    if not intent or (not intent.get("group_by_column") and not has_aggregate):
        return ChatResponseComputeTool(
            content="無法從 LLM 回覆解析出意圖 JSON。請確認 prompt 與 schema。",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    debug["intent"] = intent

    group_by = intent.get("group_by_column", "").strip()
    filters = _parse_filters_from_intent(intent)
    value_col = intent.get("value_column")
    value_cols = intent.get("value_columns")
    if isinstance(value_cols, list):
        value_cols = [str(v).strip() for v in value_cols if v]
    else:
        value_cols = None
    agg = (intent.get("aggregation") or "sum").strip().lower()
    chart_type = _infer_chart_type(req.content)
    series_by = intent.get("series_by_column")
    if series_by and not isinstance(series_by, str):
        series_by = None
    top_n = intent.get("top_n")
    if top_n is not None and not isinstance(top_n, int):
        try:
            top_n = int(top_n)
        except (ValueError, TypeError):
            top_n = None
    sort_order = (intent.get("sort_order") or "desc").strip().lower()
    time_order = bool(intent.get("time_order"))
    indicator = intent.get("indicator") if isinstance(intent.get("indicator"), str) else None
    if indicator:
        indicator = indicator.strip().lower()
        if not value_cols and indicator in _INDICATOR_DEFAULT_VALUE_COLUMNS:
            value_cols = _INDICATOR_DEFAULT_VALUE_COLUMNS[indicator]

    chart_result = compute_aggregate(
        rows,
        group_by,
        value_column=value_col,
        aggregation=agg,
        chart_type=chart_type,
        series_by_column=series_by,
        filters=filters,
        top_n=top_n,
        sort_order=sort_order,
        time_order=time_order,
        value_columns=value_cols,
        indicator=indicator,
        group_aliases=schema_def.get("group_aliases") if schema_def else None,
        value_aliases=schema_def.get("value_aliases") if schema_def else None,
    )

    if not chart_result:
        return ChatResponseComputeTool(
            content="後端計算失敗或結果為空。請確認 schema 與問題描述，或檢查 debug 中的 intent。",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    value_suffix = "元"
    if value_suffix:
        chart_result["valueSuffix"] = value_suffix
    debug["chart_result"] = chart_result
    debug["flow"] = "tool"

    detail_lines = _chart_result_to_detail_lines(chart_result)
    if not detail_lines:
        return ChatResponseComputeTool(
            content="無法格式化計算結果。請調整問題或檢查 schema。",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    text_prompt = _load_prompt("text")
    if not text_prompt:
        text_prompt = "根據計算結果撰寫分析文字，使用 Markdown 格式。圖表由後端負責，只輸出文字。"

    detail_block = "計算結果：\n" + "\n".join(detail_lines)
    user_content_text = f"""使用者問題：{req.content}

{detail_block}

請撰寫分析文字，金額與數字必須與上述完全一致。"""

    try:
        text_content, usage2 = await _call_llm(model, text_prompt, user_content_text)
    except Exception as e:
        logger.exception("文字生成 LLM 呼叫失敗")
        return ChatResponseComputeTool(
            content=f"文字生成失敗：{e}",
            model=model,
            usage=usage1,
            chart_data=None,
            debug=debug,
        )

    debug["text_usage"] = usage2

    final_content = text_content.strip()
    parsed = _extract_json_from_llm(text_content)
    if parsed and isinstance(parsed.get("text"), str):
        final_content = parsed["text"].strip()
    # chart 由後端負責，固定使用 chart_result，不以 LLM 輸出覆蓋

    total_usage = usage1 or {}
    if usage2:
        for k, v in usage2.items():
            total_usage[k] = total_usage.get(k, 0) + v

    return ChatResponseComputeTool(
        content=final_content,
        model=model,
        usage=total_usage,
        chart_data=chart_result,
        debug=debug,
    )


@router.post("/intent-to-compute", response_model=IntentToComputeResponse)
async def intent_to_compute(
    req: IntentToComputeRequest,
    db: Annotated[Session, Depends(get_db)] = ...,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """dev-test-intent-to-data 專用：接受 intent JSON，從 DuckDB 或 CSV 載入專案資料後呼叫 compute_aggregate。"""
    if not (req.agent_id or "").strip():
        raise HTTPException(status_code=400, detail="agent_id is required")
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required")
    intent = req.intent or {}
    if not isinstance(intent, dict):
        raise HTTPException(status_code=400, detail="intent 必須為 JSON 物件")

    try:
        _check_agent_access(db, current, req.agent_id.strip())
    except HTTPException:
        raise

    try:
        uuid_pid = UUID(pid)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id 格式錯誤")

    proj = db.query(BiProject).filter(BiProject.project_id == uuid_pid).first()
    if not proj or proj.user_id != str(current.id):
        raise HTTPException(status_code=404, detail="專案不存在或無權限")

    rows: list[dict[str, Any]] | None = None
    duckdb_path = get_project_duckdb_path(pid)
    if duckdb_path:
        df = execute_sql_on_duckdb_file(duckdb_path, "SELECT * FROM data")
        if df is not None and not df.empty:
            rows = df.to_dict("records")
            logger.info("intent-to-compute 從 DuckDB 載入 %d 列", len(rows))
    if not rows:
        raw_data = _get_bi_sources_content(db, current.id, pid)
        if not raw_data or not raw_data.strip():
            raise HTTPException(status_code=400, detail="請先上傳並選用 CSV 來源檔案，或同步專案至 DuckDB")
        csv_block = _extract_and_merge_csv_blocks(raw_data)
        rows = parse_csv_content(csv_block)
        if not rows:
            raise HTTPException(status_code=400, detail="無法解析 CSV 資料，請確認格式正確")

    schema_id = (proj.schema_id or "").strip() or "fact_business_operations"
    schema_def = load_schema(schema_id)
    if not schema_def:
        schema_def = load_schema("fact_business_operations")

    group_by = (intent.get("group_by_column") or "").strip()
    value_col = intent.get("value_column")
    value_cols = intent.get("value_columns")
    if isinstance(value_cols, list):
        value_cols = [str(v).strip() for v in value_cols if v]
    else:
        value_cols = None
    agg = (intent.get("aggregation") or "sum").strip().lower()
    chart_type = (intent.get("chart_type") or "bar").strip().lower() or "bar"
    series_by = intent.get("series_by_column")
    if series_by and not isinstance(series_by, str):
        series_by = None
    filters = _parse_filters_from_intent(intent)
    top_n = intent.get("top_n")
    if top_n is not None and not isinstance(top_n, int):
        try:
            top_n = int(top_n)
        except (ValueError, TypeError):
            top_n = None
    sort_order = (intent.get("sort_order") or "desc").strip().lower()
    time_order = bool(intent.get("time_order"))
    indicator = intent.get("indicator") if isinstance(intent.get("indicator"), str) else None
    if indicator:
        indicator = indicator.strip().lower()
        if not value_cols and indicator in _INDICATOR_DEFAULT_VALUE_COLUMNS:
            value_cols = _INDICATOR_DEFAULT_VALUE_COLUMNS[indicator]
    display_fields = intent.get("display_fields")
    if isinstance(display_fields, list):
        display_fields = [str(d).strip() for d in display_fields if d]
    else:
        display_fields = None

    chart_result = compute_aggregate(
        rows,
        group_by,
        value_column=value_col,
        aggregation=agg,
        chart_type=chart_type,
        series_by_column=series_by,
        filters=filters,
        top_n=top_n,
        sort_order=sort_order,
        time_order=time_order,
        value_columns=value_cols,
        indicator=indicator,
        display_fields=display_fields,
        group_aliases=schema_def.get("group_aliases") if schema_def else None,
        value_aliases=schema_def.get("value_aliases") if schema_def else None,
    )
    return IntentToComputeResponse(chart_result=chart_result)


def _load_rows_from_project(pid: str, db: Session, user_id: int) -> tuple[list[dict[str, Any]], Any]:
    """從專案載入 rows：優先 DuckDB，無則 CSV。回傳 (rows, proj)。"""
    try:
        uuid_pid = UUID(pid)
    except ValueError:
        raise HTTPException(status_code=400, detail="project_id 格式錯誤")
    proj = db.query(BiProject).filter(BiProject.project_id == uuid_pid).first()
    if not proj or proj.user_id != str(user_id):
        raise HTTPException(status_code=404, detail="專案不存在或無權限")
    rows = None
    duckdb_path = get_project_duckdb_path(pid)
    if duckdb_path:
        df = execute_sql_on_duckdb_file(duckdb_path, "SELECT * FROM data")
        if df is not None and not df.empty:
            rows = df.to_dict("records")
            logger.info("從 DuckDB 載入 %d 列", len(rows))
    if not rows:
        raw_data = _get_bi_sources_content(db, user_id, pid)
        if not raw_data or not raw_data.strip():
            raise HTTPException(status_code=400, detail="請先上傳並選用 CSV 來源檔案，或同步專案至 DuckDB")
        csv_block = _extract_and_merge_csv_blocks(raw_data)
        rows = parse_csv_content(csv_block)
        if not rows:
            raise HTTPException(status_code=400, detail="無法解析 CSV 資料，請確認格式正確")
    return rows, proj


@router.post("/intent-to-compute-by-project", response_model=IntentToComputeResponse)
async def intent_to_compute_by_project(
    req: IntentToComputeByProjectRequest,
    db: Annotated[Session, Depends(get_db)] = ...,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """dev-test-intent-to-data 專用：僅需 project_id，從 DuckDB 載入資料。無需 agent_id。"""
    pid = (req.project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required")
    intent = req.intent or {}
    if not isinstance(intent, dict):
        raise HTTPException(status_code=400, detail="intent 必須為 JSON 物件")

    rows, proj = _load_rows_from_project(pid, db, current.id)

    schema_id = (proj.schema_id or "").strip() or "fact_business_operations"
    schema_def = load_schema(schema_id)
    if not schema_def:
        schema_def = load_schema("fact_business_operations")

    group_by = (intent.get("group_by_column") or "").strip()
    value_col = intent.get("value_column")
    value_cols = intent.get("value_columns")
    if isinstance(value_cols, list):
        value_cols = [str(v).strip() for v in value_cols if v]
    else:
        value_cols = None
    agg = (intent.get("aggregation") or "sum").strip().lower()
    chart_type = (intent.get("chart_type") or "bar").strip().lower() or "bar"
    series_by = intent.get("series_by_column")
    if series_by and not isinstance(series_by, str):
        series_by = None
    filters = _parse_filters_from_intent(intent)
    top_n = intent.get("top_n")
    if top_n is not None and not isinstance(top_n, int):
        try:
            top_n = int(top_n)
        except (ValueError, TypeError):
            top_n = None
    sort_order = (intent.get("sort_order") or "desc").strip().lower()
    time_order = bool(intent.get("time_order"))
    indicator = intent.get("indicator") if isinstance(intent.get("indicator"), str) else None
    if indicator:
        indicator = indicator.strip().lower()
        if not value_cols and indicator in _INDICATOR_DEFAULT_VALUE_COLUMNS:
            value_cols = _INDICATOR_DEFAULT_VALUE_COLUMNS[indicator]
    display_fields = intent.get("display_fields")
    if isinstance(display_fields, list):
        display_fields = [str(d).strip() for d in display_fields if d]
    else:
        display_fields = None

    chart_result = compute_aggregate(
        rows,
        group_by,
        value_column=value_col,
        aggregation=agg,
        chart_type=chart_type,
        series_by_column=series_by,
        filters=filters,
        top_n=top_n,
        sort_order=sort_order,
        time_order=time_order,
        value_columns=value_cols,
        indicator=indicator,
        display_fields=display_fields,
        group_aliases=schema_def.get("group_aliases") if schema_def else None,
        value_aliases=schema_def.get("value_aliases") if schema_def else None,
    )
    return IntentToComputeResponse(chart_result=chart_result)


@router.post("/intent-to-compute-raw", response_model=IntentToComputeResponse)
async def intent_to_compute_raw(
    req: IntentToComputeRawRequest,
    current: Annotated[User, Depends(get_current_user)] = ...,
):
    """dev-test-intent-to-data 專用：接受 intent + rows，無需 agent/project。"""
    intent = req.intent or {}
    rows = req.rows or []
    if not isinstance(intent, dict):
        raise HTTPException(status_code=400, detail="intent 必須為 JSON 物件")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=400, detail="rows 必須為非空陣列")
    if not isinstance(rows[0], dict):
        raise HTTPException(status_code=400, detail="rows 每筆必須為物件")

    schema_def = load_schema("fact_business_operations")
    filters = _parse_filters_from_intent(intent)
    display_fields = intent.get("display_fields")
    if isinstance(display_fields, list):
        display_fields = [str(d).strip() for d in display_fields if d]
    else:
        display_fields = None
    group_by = (intent.get("group_by_column") or "").strip()
    value_col = intent.get("value_column")
    value_cols = intent.get("value_columns")
    if isinstance(value_cols, list):
        value_cols = [str(v).strip() for v in value_cols if v]
    else:
        value_cols = None
    agg = (intent.get("aggregation") or "sum").strip().lower()
    chart_type = (intent.get("chart_type") or "bar").strip().lower() or "bar"
    series_by = intent.get("series_by_column")
    if series_by and not isinstance(series_by, str):
        series_by = None
    top_n = intent.get("top_n")
    if top_n is not None and not isinstance(top_n, int):
        try:
            top_n = int(top_n)
        except (ValueError, TypeError):
            top_n = None
    sort_order = (intent.get("sort_order") or "desc").strip().lower()
    time_order = bool(intent.get("time_order"))
    indicator = intent.get("indicator") if isinstance(intent.get("indicator"), str) else None
    if indicator:
        indicator = indicator.strip().lower()
        if not value_cols and indicator in _INDICATOR_DEFAULT_VALUE_COLUMNS:
            value_cols = _INDICATOR_DEFAULT_VALUE_COLUMNS[indicator]

    chart_result = compute_aggregate(
        rows,
        group_by,
        value_column=value_col,
        aggregation=agg,
        chart_type=chart_type,
        series_by_column=series_by,
        filters=filters,
        top_n=top_n,
        sort_order=sort_order,
        time_order=time_order,
        value_columns=value_cols,
        indicator=indicator,
        display_fields=display_fields,
        group_aliases=schema_def.get("group_aliases") if schema_def else None,
        value_aliases=schema_def.get("value_aliases") if schema_def else None,
    )
    return IntentToComputeResponse(chart_result=chart_result)
