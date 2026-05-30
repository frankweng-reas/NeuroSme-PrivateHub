from sqlalchemy.orm import Session


def resolve_tenant_model(model: str, db: Session, tenant_id: str) -> str:
    """解析 LLM model：前端指定 > 租戶預設。"""
    use_model = (model or "").strip()
    if use_model:
        return use_model

    from app.models.llm_provider_config import LLMProviderConfig

    cfg = (
        db.query(LLMProviderConfig)
        .filter(
            LLMProviderConfig.tenant_id == tenant_id,
            LLMProviderConfig.is_active.is_(True),
        )
        .order_by(LLMProviderConfig.id)
        .first()
    )
    if not cfg:
        return ""

    dm = (cfg.default_model or "").strip()
    provider = cfg.provider
    if provider == "gemini":
        return dm if dm.startswith("gemini/") else f"gemini/{dm}" if dm else "gemini/gemini-2.0-flash"
    if provider == "local":
        return dm if dm.startswith("local/") else f"local/{dm}" if dm else ""
    if provider == "twcc":
        return dm if dm.startswith("twcc/") else f"twcc/{dm}" if dm else ""
    return dm or "gpt-4o-mini"
