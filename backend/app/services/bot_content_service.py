"""Bot 對外展示內容（首頁、熱門/常見 FAQ、聯絡資訊）— Widget 與 Public API 共用。"""
from __future__ import annotations

import json

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models.bot import Bot, BotFaq


class BotContentFaqItem(BaseModel):
    id: int
    question: str
    answer: str


class BotContentContactLink(BaseModel):
    type: str  # phone | email | line | form | url
    label: str
    value: str


class BotContentData(BaseModel):
    bot_id: int
    title: str
    logo_url: str | None
    color: str
    lang: str
    home_enabled: bool
    home_greeting: str | None
    home_quick_questions: list[str]
    popular_faq_enabled: bool
    common_faq_enabled: bool
    popular_faqs: list[BotContentFaqItem]
    common_faqs: list[BotContentFaqItem]
    contact_enabled: bool
    contact_links: list[BotContentContactLink]


def parse_json_list(raw: str | None, default: list) -> list:
    if not raw:
        return default
    try:
        result = json.loads(raw)
        return result if isinstance(result, list) else default
    except Exception:
        return default


def _load_faqs(db: Session, bot_id: int, faq_type: str) -> list[BotContentFaqItem]:
    rows = (
        db.query(BotFaq)
        .filter(
            BotFaq.bot_id == bot_id,
            BotFaq.is_active.is_(True),
            BotFaq.faq_type == faq_type,
        )
        .order_by(BotFaq.sort_order, BotFaq.id)
        .all()
    )
    return [BotContentFaqItem(id=r.id, question=r.question, answer=r.answer) for r in rows]


def build_bot_content(bot: Bot, db: Session) -> BotContentData:
    """組裝 Bot 對外展示內容（僅含已啟用區塊的 FAQ / 聯絡方式）。"""
    popular_faqs = _load_faqs(db, bot.id, "popular") if (bot.popular_faq_enabled or False) else []
    common_faqs = _load_faqs(db, bot.id, "common") if (bot.common_faq_enabled or False) else []

    raw_contact = parse_json_list(bot.contact_links, []) if (bot.contact_enabled or False) else []
    contact_links = [
        BotContentContactLink(
            type=lk.get("type", "url"),
            label=lk.get("label", ""),
            value=lk.get("value", ""),
        )
        for lk in raw_contact
        if isinstance(lk, dict) and lk.get("label") and lk.get("value")
    ]

    return BotContentData(
        bot_id=bot.id,
        title=bot.widget_title or bot.name,
        logo_url=bot.widget_logo_url,
        color=bot.widget_color or "#1A3A52",
        lang=bot.widget_lang or "zh-TW",
        home_enabled=bot.home_enabled or False,
        home_greeting=bot.home_greeting,
        home_quick_questions=parse_json_list(bot.home_quick_questions, []),
        popular_faq_enabled=bot.popular_faq_enabled or False,
        common_faq_enabled=bot.common_faq_enabled or False,
        popular_faqs=popular_faqs,
        common_faqs=common_faqs,
        contact_enabled=bot.contact_enabled or False,
        contact_links=contact_links,
    )
