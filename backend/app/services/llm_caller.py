"""統一 LLM 呼叫層

設計目標：
  - 所有需要呼叫 LiteLLM 的地方（chat、widget、public API 等）統一走此模組
  - kwargs 組裝邏輯（model 解析、api_base、think=False）只寫一次
  - 上層 endpoint 只需傳入業務參數，不再自行組裝 LiteLLM kwargs

公開介面：
  build_llm_kwargs(model, messages, db, tenant_id, stream, temperature)
      → dict  純粹組裝，不呼叫 LiteLLM，方便測試與串流場景

  call_llm(model, messages, db, tenant_id, **overrides)
      → (litellm.ModelResponse, UsageMeta | None, int latency_ms)
      非串流呼叫，適合 RAG 問答、OCR 等一次性需要完整回答的場景

  call_llm_stream(model, messages, db, tenant_id, **overrides)
      → AsyncGenerator[str, None]
      串流呼叫，逐 token yield 文字片段，適合聊天介面

例外行為：
  - LLM provider 的 api_key 未設定 → 拋 LLMProviderNotConfigured
  - LiteLLM 呼叫失敗             → 拋 LLMCallError（包含原始 exception）
  上層 endpoint 可自行決定是否轉成 HTTPException
"""
import re
import logging
import time
from collections.abc import AsyncGenerator

import litellm
from sqlalchemy.orm import Session

from app.services.llm_service import LLMResolveResult, UsageMeta, _get_llm_params, _get_provider_name

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# <think>...</think> 過濾（用於 reasoning model 回應）
# ──────────────────────────────────────────────────────────────────────────────

_THINK_OPEN_TAGS = ["<think>", "<|channel>thought"]
_THINK_CLOSE_TAGS = ["</think>", "<channel|>"]


class _ThinkStripper:
    """串流狀態機：過濾多種 thinking 區塊格式（跨 chunk 安全）

    支援格式：
      - <think>...</think>          標準格式（Ollama DeepSeek / Qwen3 等）
      - <|channel>thought...<channel|>  Ardge AI / Gemma 4 格式
    """

    # open/close tag 最長長度，用於 partial-match 保護
    _MAX_TAG_LEN = max(len(t) for t in _THINK_OPEN_TAGS + _THINK_CLOSE_TAGS)

    def __init__(self) -> None:
        self._in_think = False
        self._close_tag = ""   # 目前 thinking 區塊對應的結束標籤
        self._pending = ""

    def feed(self, text: str) -> str:
        result = ""
        buf = self._pending + text
        self._pending = ""

        while buf:
            if self._in_think:
                end = buf.find(self._close_tag)
                if end >= 0:
                    self._in_think = False
                    buf = buf[end + len(self._close_tag):]
                    if buf.startswith("\n"):
                        buf = buf[1:]
                else:
                    keep = max(0, len(buf) - len(self._close_tag))
                    self._pending = buf[keep:]
                    buf = ""
            else:
                # 尋找最早出現的 open tag
                earliest_start = -1
                matched_open = ""
                matched_close = ""
                for open_tag, close_tag in zip(_THINK_OPEN_TAGS, _THINK_CLOSE_TAGS):
                    pos = buf.find(open_tag)
                    if pos >= 0 and (earliest_start < 0 or pos < earliest_start):
                        earliest_start = pos
                        matched_open = open_tag
                        matched_close = close_tag

                if earliest_start >= 0:
                    result += buf[:earliest_start]
                    self._in_think = True
                    self._close_tag = matched_close
                    buf = buf[earliest_start + len(matched_open):]
                else:
                    # 尾部部分前綴保護
                    partial_start = -1
                    for i in range(1, self._MAX_TAG_LEN):
                        for open_tag in _THINK_OPEN_TAGS:
                            prefix = open_tag[:i]
                            if buf.endswith(prefix):
                                candidate = len(buf) - i
                                if partial_start < 0 or candidate < partial_start:
                                    partial_start = candidate
                    if partial_start >= 0:
                        result += buf[:partial_start]
                        self._pending = buf[partial_start:]
                    else:
                        result += buf
                    buf = ""

        return result


def _strip_think_blocks(text: str) -> str:
    """非串流版本：移除完整的 thinking 區塊"""
    text = re.sub(r"<think>.*?</think>\n?", "", text, flags=re.DOTALL)
    text = re.sub(r"<\|channel>thought.*?<channel\|>\n?", "", text, flags=re.DOTALL)
    return text


# ──────────────────────────────────────────────────────────────────────────────
# 自訂例外
# ──────────────────────────────────────────────────────────────────────────────

class LLMProviderNotConfigured(Exception):
    """該 provider 的連線設定尚未在租戶設定中完成"""
    def __init__(self, model: str):
        provider = _get_provider_name(model)
        if model.startswith("vertex_ai/"):
            msg = (
                "Vertex AI 尚未設定完成，請在 NeuroSme 管理介面設定 GCP Project ID 與 Region"
                "（GCP VM 可留空 Service Account JSON，使用預設 Service Account）"
            )
        else:
            msg = f"{provider} API Key 未設定，請在 NeuroSme 管理介面設定對應的 key"
        super().__init__(msg)
        self.model = model
        self.provider = provider


class LLMCallError(Exception):
    """LiteLLM 呼叫失敗"""
    def __init__(self, message: str, cause: Exception | None = None):
        super().__init__(message)
        self.cause = cause


# ──────────────────────────────────────────────────────────────────────────────
# kwargs 組裝
# ──────────────────────────────────────────────────────────────────────────────

def resolve_llm_params(model: str, db: Session, tenant_id: str) -> LLMResolveResult:
    """
    查詢 DB 取得 LLM 連線參數；未設定則拋 LLMProviderNotConfigured。
    """
    resolved = _get_llm_params(model, db=db, tenant_id=tenant_id)
    if not resolved.is_configured():
        raise LLMProviderNotConfigured(model)
    return resolved


def build_llm_kwargs(
    *,
    model: str,
    messages: list[dict],
    db: Session,
    tenant_id: str,
    stream: bool = False,
    temperature: float = 0.3,
    **extra,
) -> dict:
    """
    組裝完整的 LiteLLM kwargs，包含：
      - model 名稱解析（local/ → ollama_chat/、twcc/ → openai/ 等）
      - api_key、api_base 注入
      - 本地 Ollama 模型停用 thinking mode（think=False）
      - 呼叫端可透過 **extra 覆寫任何欄位

    不會呼叫 LiteLLM，純粹回傳 dict，方便單元測試。
    """
    resolved = resolve_llm_params(model, db, tenant_id)

    kwargs: dict = {
        "model": resolved.litellm_model,
        "messages": messages,
        "stream": stream,
        "temperature": temperature,
        **extra,
    }
    resolved.apply_to_kwargs(kwargs)

    # Ollama 本地模型預設會啟用 thinking mode，對 RAG 問答造成大幅延遲，需明確停用
    if model.startswith("local/") or resolved.litellm_model.startswith("ollama_chat/"):
        kwargs.setdefault("think", False)

    # 自訂 OpenAI-compatible provider：嘗試透過 extra_body 停用 thinking
    # 伺服器若不支援此參數通常會忽略；若支援則可減少 thinking 延遲
    if resolved.is_custom_provider:
        kwargs.setdefault("extra_body", {})
        kwargs["extra_body"].setdefault("enable_thinking", False)

    return kwargs


# ──────────────────────────────────────────────────────────────────────────────
# Pre-resolved variant（chat.py 等已在上游解析過 params 時使用，避免重複 DB 查詢）
# ──────────────────────────────────────────────────────────────────────────────

def build_llm_kwargs_resolved(
    *,
    resolved: LLMResolveResult,
    original_model: str,
    messages: list[dict],
    stream: bool = False,
    temperature: float = 0.3,
    **extra,
) -> dict:
    """
    同 build_llm_kwargs，但接受已解析好的 LLMResolveResult，跳過 DB 查詢。
    original_model 用於判斷是否為 local/ 模型。
    """
    kwargs: dict = {
        "model": resolved.litellm_model,
        "messages": messages,
        "stream": stream,
        "temperature": temperature,
        **extra,
    }
    resolved.apply_to_kwargs(kwargs)
    if original_model.startswith("local/") or resolved.litellm_model.startswith("ollama_chat/"):
        kwargs.setdefault("think", False)
    if resolved.is_custom_provider:
        kwargs.setdefault("extra_body", {})
        kwargs["extra_body"].setdefault("enable_thinking", False)
    return kwargs


# ──────────────────────────────────────────────────────────────────────────────
# 非串流呼叫
# ──────────────────────────────────────────────────────────────────────────────

async def call_llm(
    *,
    model: str,
    messages: list[dict],
    db: Session,
    tenant_id: str,
    temperature: float = 0.3,
    **extra,
) -> tuple[str, UsageMeta | None, int]:
    """
    非串流 LLM 呼叫。

    Returns:
        (answer: str, usage: UsageMeta | None, latency_ms: int)

    Raises:
        LLMProviderNotConfigured  – api_key 未設定
        LLMCallError              – LiteLLM 呼叫失敗
    """
    kwargs = build_llm_kwargs(
        model=model,
        messages=messages,
        db=db,
        tenant_id=tenant_id,
        stream=False,
        temperature=temperature,
        **extra,
    )

    t0 = time.perf_counter()
    try:
        resp = await litellm.acompletion(**kwargs)
    except Exception as exc:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        logger.error("call_llm failed model=%s latency=%dms: %s", model, latency_ms, exc)
        raise LLMCallError(f"LLM 呼叫失敗：{exc}", cause=exc) from exc

    latency_ms = int((time.perf_counter() - t0) * 1000)
    answer = _strip_think_blocks(resp.choices[0].message.content or "")

    usage: UsageMeta | None = None
    if hasattr(resp, "usage") and resp.usage:
        usage = UsageMeta(
            prompt_tokens=resp.usage.prompt_tokens or 0,
            completion_tokens=resp.usage.completion_tokens or 0,
            total_tokens=resp.usage.total_tokens or 0,
        )

    return answer, usage, latency_ms


# ──────────────────────────────────────────────────────────────────────────────
# 串流呼叫
# ──────────────────────────────────────────────────────────────────────────────

async def call_llm_stream(
    *,
    model: str,
    messages: list[dict],
    db: Session,
    tenant_id: str,
    temperature: float = 0.3,
    **extra,
) -> AsyncGenerator[str, None]:
    """
    串流 LLM 呼叫，逐 token yield 文字片段。

    Usage:
        async for chunk in call_llm_stream(model=..., messages=..., ...):
            yield f"data: {chunk}\\n\\n"

    Raises:
        LLMProviderNotConfigured  – api_key 未設定（在第一個 yield 前拋出）
        LLMCallError              – LiteLLM 呼叫失敗
    """
    kwargs = build_llm_kwargs(
        model=model,
        messages=messages,
        db=db,
        tenant_id=tenant_id,
        stream=True,
        temperature=temperature,
        **extra,
    )

    try:
        response = await litellm.acompletion(**kwargs)
    except Exception as exc:
        logger.error("call_llm_stream failed model=%s: %s", model, exc)
        raise LLMCallError(f"LLM 串流呼叫失敗：{exc}", cause=exc) from exc

    stripper = _ThinkStripper()
    async for chunk in response:
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta and delta.content:
            filtered = stripper.feed(delta.content)
            if filtered:
                yield filtered
