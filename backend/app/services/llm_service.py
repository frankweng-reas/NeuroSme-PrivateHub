"""LLM 服務：DB-based 參數取得、provider 判斷、台智雲 model 名稱、request 持久化

設計原則：
  - 此模組只依賴 DB models 與核心工具，不依賴任何 endpoint 的 request/response 型別
  - 避免循環 import：ChatResponse / ChatRequest 留在 chat.py，不引入此模組
  - 統一提供 UsageMeta，讓 chat.py 從此 import 而非自行定義
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

import aiohttp
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.encryption import decrypt_api_key
from app.models.chat_llm_request import ChatLlmRequest
from app.models.llm_provider_config import LLMProviderConfig
from app.services.agent_usage import log_agent_usage
from app.services.llm_utils import apply_api_base, apply_vertex_to_kwargs, normalize_gcp_region

logger = logging.getLogger(__name__)

# 台智雲模型名稱對照：前端格式 -> API 格式（小寫連字號 + -chat）
_TWCC_MODEL_MAP: dict[str, str] = {
    "Llama3.1-FFM-8B-32K": "llama3.1-ffm-8b-32k-chat",
    "Llama3.3-FFM-70B-32K": "llama3.3-ffm-70b-32k-chat",
}


class UsageMeta(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


@dataclass
class LLMResolveResult:
    """LiteLLM 呼叫所需之解析結果（含 Vertex ADC / Service Account）。"""

    litellm_model: str
    api_key: str | None = None
    api_base: str | None = None
    vertex_project: str | None = None
    vertex_location: str | None = None
    vertex_credentials: str | None = None
    is_custom_provider: bool = False

    def is_configured(self) -> bool:
        if self.litellm_model.startswith("vertex_ai/"):
            return bool((self.vertex_project or "").strip() and (self.vertex_location or "").strip())
        if self.litellm_model.startswith("local/") or self.litellm_model.startswith("ollama_chat/"):
            return True
        if self.is_custom_provider:
            return bool((self.api_base or "").strip())
        return bool(self.api_key)

    def apply_to_kwargs(self, kwargs: dict) -> None:
        apply_api_base(kwargs, self.api_base)
        if self.litellm_model.startswith("vertex_ai/"):
            apply_vertex_to_kwargs(
                kwargs,
                project=self.vertex_project or "",
                location=self.vertex_location or "",
                credentials=self.vertex_credentials,
            )
        elif self.api_key:
            kwargs["api_key"] = self.api_key


def _vertex_from_cfg(cfg: LLMProviderConfig | None, litellm_model: str) -> LLMResolveResult:
    if not cfg:
        return LLMResolveResult(litellm_model)
    creds: str | None = None
    if cfg.api_key_encrypted:
        try:
            creds = decrypt_api_key(cfg.api_key_encrypted)
        except ValueError:
            logger.warning("LLMProviderConfig id=%s provider=vertex 解密失敗", cfg.id)
    return LLMResolveResult(
        litellm_model=litellm_model,
        vertex_project=cfg.gcp_project_id,
        vertex_location=normalize_gcp_region(cfg.gcp_region or ""),
        vertex_credentials=creds,
    )


def _get_llm_params(model: str, db=None, tenant_id: str | None = None) -> LLMResolveResult:
    """
    依 model 回傳 LiteLLM 連線參數。
    Vertex：優先 DB 的 gcp_project_id / gcp_region；金鑰可留空改走 VM ADC。
    """

    def _db_cfg(provider: str) -> LLMProviderConfig | None:
        if db is None or not tenant_id:
            return None
        return (
            db.query(LLMProviderConfig)
            .filter(
                LLMProviderConfig.tenant_id == tenant_id,
                LLMProviderConfig.provider == provider,
                LLMProviderConfig.is_active.is_(True),
            )
            .order_by(LLMProviderConfig.id)
            .first()
        )

    def _db_key(provider: str) -> tuple[str | None, str | None]:
        cfg = _db_cfg(provider)
        if not cfg:
            return None, None
        key: str | None = None
        if cfg.api_key_encrypted:
            try:
                key = decrypt_api_key(cfg.api_key_encrypted)
            except ValueError:
                logger.warning("LLMProviderConfig id=%s provider=%s 解密失敗", cfg.id, provider)
        return key, cfg.api_base_url

    if model.startswith("vertex_ai/"):
        return _vertex_from_cfg(_db_cfg("vertex"), model)
    if model.startswith("gemini/"):
        db_key, _ = _db_key("gemini")
        return LLMResolveResult(litellm_model=model, api_key=db_key)
    if model.startswith("twcc/"):
        db_key, db_base = _db_key("twcc")
        return LLMResolveResult(litellm_model=f"openai/{model[5:]}", api_key=db_key, api_base=db_base)
    if model.startswith("local/"):
        db_key, db_base = _db_key("local")
        return LLMResolveResult(
            litellm_model=f"ollama_chat/{model[6:]}",
            api_key=db_key or "local",
            api_base=db_base,
        )
    if model.startswith("anthropic/") or model.startswith("claude-"):
        db_key, _ = _db_key("anthropic")
        litellm_model = model if model.startswith("anthropic/") else f"anthropic/{model}"
        return LLMResolveResult(litellm_model=litellm_model, api_key=db_key)
    if model.startswith("custom:"):
        # 格式：custom:{config_id}/{model_name}
        rest = model[7:]
        slash_idx = rest.find("/")
        if slash_idx >= 0:
            try:
                config_id = int(rest[:slash_idx])
            except ValueError:
                config_id = -1
            model_name = rest[slash_idx + 1:]
        else:
            config_id = -1
            model_name = rest
        if db and config_id > 0:
            cfg = (
                db.query(LLMProviderConfig)
                .filter(
                    LLMProviderConfig.id == config_id,
                    LLMProviderConfig.is_active.is_(True),
                )
                .first()
            )
            if cfg:
                api_key: str | None = None
                if cfg.api_key_encrypted:
                    try:
                        api_key = decrypt_api_key(cfg.api_key_encrypted)
                    except ValueError:
                        logger.warning("LLMProviderConfig id=%s provider=custom 解密失敗", cfg.id)
                return LLMResolveResult(
                    litellm_model=f"openai/{model_name}",
                    api_key=api_key,
                    api_base=cfg.api_base_url,
                    is_custom_provider=True,
                )
        return LLMResolveResult(litellm_model=f"openai/{model_name}", is_custom_provider=True)

    # Fallback：model 無已知前綴，嘗試從 custom provider 中配對（向下相容舊的未帶前綴格式）
    if db and tenant_id:
        custom_cfgs = (
            db.query(LLMProviderConfig)
            .filter(
                LLMProviderConfig.tenant_id == tenant_id,
                LLMProviderConfig.provider == "custom",
                LLMProviderConfig.is_active.is_(True),
            )
            .order_by(LLMProviderConfig.id)
            .all()
        )
        matched_cfg: LLMProviderConfig | None = None
        for c in custom_cfgs:
            raw = c.available_models
            names: list[str] = []
            if isinstance(raw, list):
                for item in raw:
                    if isinstance(item, dict):
                        mid = str(item.get("model", "")).strip()
                        if mid:
                            names.append(mid)
                    elif isinstance(item, str) and item.strip():
                        names.append(item.strip())
            dm = (c.default_model or "").strip()
            if dm:
                names.append(dm)
            if model in names:
                matched_cfg = c
                break
        # 若只有一個 custom provider 且沒有找到精確配對，也使用它（單一 custom 場景）
        if matched_cfg is None and len(custom_cfgs) == 1:
            matched_cfg = custom_cfgs[0]
        if matched_cfg is not None:
            api_key: str | None = None
            if matched_cfg.api_key_encrypted:
                try:
                    api_key = decrypt_api_key(matched_cfg.api_key_encrypted)
                except ValueError:
                    logger.warning("LLMProviderConfig id=%s provider=custom fallback 解密失敗", matched_cfg.id)
            return LLMResolveResult(
                litellm_model=f"openai/{model}",
                api_key=api_key,
                api_base=matched_cfg.api_base_url,
                is_custom_provider=True,
            )

    db_key, _ = _db_key("openai")
    return LLMResolveResult(litellm_model=model, api_key=db_key)


def _infer_llm_provider(model: str) -> str:
    m = (model or "").strip()
    if m.startswith("vertex_ai/"):
        return "vertex"
    if m.startswith("gemini/"):
        return "gemini"
    if m.startswith("twcc/"):
        return "twcc"
    if m.startswith("anthropic/") or m.startswith("claude-"):
        return "anthropic"
    if m.startswith("custom:"):
        return "custom"
    return "openai"


def _get_provider_name(model: str) -> str:
    if model.startswith("vertex_ai/"):
        return "Vertex AI"
    if model.startswith("gemini/"):
        return "Gemini"
    if model.startswith("twcc/"):
        return "台智雲"
    if model.startswith("local/"):
        return "本機模型"
    if model.startswith("anthropic/") or model.startswith("claude-"):
        return "Anthropic"
    if model.startswith("custom:"):
        return "自訂"
    return "OpenAI"


def _twcc_model_id(frontend_model: str) -> str:
    """將前端模型名稱轉為台智雲 API 格式。例：Llama3.1-FFM-8B-32K -> llama3.1-ffm-8b-32k-chat"""
    key = frontend_model.strip()
    if key in _TWCC_MODEL_MAP:
        return _TWCC_MODEL_MAP[key]
    normalized = key.lower().replace(" ", "-").replace("_", "-")
    return f"{normalized}-chat" if not normalized.endswith("-chat") else normalized


def _persist_chat_llm_request(
    db: Session,
    *,
    tenant_id: str,
    user_id: int,
    thread_id: UUID,
    model: str,
    trace_id: str | None,
    latency_ms: int,
    status: str,
    usage: UsageMeta | None,
    finish_reason: str | None,
    error_code: str | None,
    error_message: str | None,
    agent_id: str = "chat",
) -> UUID:
    msg = (error_message or "").strip()[:8000] if error_message else None
    tid = (trace_id or "").strip()[:128] if trace_id else None
    row = ChatLlmRequest(
        tenant_id=tenant_id,
        user_id=user_id,
        thread_id=thread_id,
        model=model or None,
        provider=_infer_llm_provider(model),
        prompt_tokens=usage.prompt_tokens if usage else None,
        completion_tokens=usage.completion_tokens if usage else None,
        total_tokens=usage.total_tokens if usage else None,
        latency_ms=latency_ms,
        finished_at=datetime.now(timezone.utc),
        status=status,
        error_code=error_code,
        error_message=msg,
        trace_id=tid,
    )
    db.add(row)
    db.flush()
    log_agent_usage(
        db=db,
        agent_type=agent_id,
        tenant_id=tenant_id,
        user_id=user_id,
        model=model or None,
        prompt_tokens=usage.prompt_tokens if usage else None,
        completion_tokens=usage.completion_tokens if usage else None,
        total_tokens=usage.total_tokens if usage else None,
        latency_ms=latency_ms,
        status=status,
    )
    return row.id
