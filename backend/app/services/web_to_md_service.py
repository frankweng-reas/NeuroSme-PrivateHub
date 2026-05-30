"""網頁 → 正文抽取 → HTML 快照 PDF → 結構化 MD 管線（Phase 1）。

Phase 1：trafilatura 抓取 + 正文抽取；PyMuPDF Story 將 HTML 轉 PDF。
後續可再加 Playwright 處理重度 JS 網站。
"""
from __future__ import annotations

import asyncio
import html
import ipaddress
import logging
import re
import socket
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="web-to-md")

_MAX_HTML_CHARS = 2 * 1024 * 1024
_FETCH_TIMEOUT_SEC = 45

_BLOCKED_HOSTS = frozenset({
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
})


@dataclass
class WebPreview:
    source_url: str
    title: str
    content_html: str
    preview_html: str
    text_length: int
    excerpt: str


class WebFetchError(ValueError):
    """使用者可讀的網頁擷取錯誤。"""


def validate_public_url(url: str) -> str:
    """僅允許 http(s) 且解析後非內網/保留位址（SSRF 防護）。"""
    raw = (url or "").strip()
    if not raw:
        raise WebFetchError("請輸入 URL")
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise WebFetchError("僅支援 http:// 或 https://")
    if not parsed.hostname:
        raise WebFetchError("URL 格式不正確")
    host = parsed.hostname.lower().rstrip(".")
    if host in _BLOCKED_HOSTS or host.endswith(".local") or host.endswith(".internal"):
        raise WebFetchError("不允許存取此網址")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise WebFetchError(f"無法解析網域：{host}") from exc
    seen: set[str] = set()
    for info in infos:
        addr = info[4][0]
        if addr in seen:
            continue
        seen.add(addr)
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise WebFetchError("不允許存取內部或保留 IP 位址")
    return raw


def _title_from_url(url: str) -> str:
    path = urlparse(url).path.rstrip("/").split("/")[-1]
    if path:
        return re.sub(r"[^\w\u4e00-\u9fff.-]+", " ", path).strip() or "webpage"
    return urlparse(url).netloc or "webpage"


def _text_to_simple_html(text: str) -> str:
    parts = [f"<p>{html.escape(p.strip())}</p>" for p in text.split("\n\n") if p.strip()]
    return "\n".join(parts) if parts else f"<p>{html.escape(text.strip())}</p>"


_PREVIEW_CSS = """
body { font-family: "Noto Sans TC", sans-serif; font-size: 16px; line-height: 1.65;
       color: #1f2937; margin: 0; padding: 16px 20px; background: #fff; }
.banner { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46;
          border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 14px; }
.source { color: #6b7280; font-size: 13px; margin-bottom: 12px; word-break: break-all; }
h1,h2,h3 { color: #111827; margin-top: 1.2em; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; }
td, th { border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: top; }
img { max-width: 100%; height: auto; }
"""

def _wrap_preview_html(content_html: str, title: str, source_url: str) -> str:
    safe_title = html.escape(title)
    safe_url = html.escape(source_url)
    fragment = _normalize_content_html(content_html)
    return (
        f"<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<title>{safe_title}</title><style>{_PREVIEW_CSS}</style></head><body>"
        f"<div class='banner'>正文預覽（已自動去除導覽列、頁尾等常見雜訊，請確認後再結構化）</div>"
        f"<div class='source'>來源：<a href='{safe_url}' target='_blank' rel='noopener'>{safe_url}</a></div>"
        f"{fragment}</body></html>"
    )


def _normalize_content_html(raw: str) -> str:
    """只保留可嵌入 preview 的 body 片段，避免 <html><body> 嵌套。"""
    raw = (raw or "").strip()
    if not raw:
        return raw
    lowered = raw.lower()
    if lowered.startswith("<!doctype") or lowered.startswith("<html"):
        try:
            from lxml import html as lxml_html

            doc = lxml_html.fromstring(raw)
            bodies = doc.xpath("//body")
            if bodies:
                inner = lxml_html.tostring(bodies[0], encoding="unicode", method="html")
                inner = re.sub(r"^<body[^>]*>", "", inner, flags=re.I)
                inner = re.sub(r"</body>\s*$", "", inner, flags=re.I)
                return inner.strip()
        except Exception:
            logger.debug("normalize content html failed, use raw fragment")
    return raw


def _html_fragment_to_plain(fragment: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    text = re.sub(r"</p>", "\n\n", text, flags=re.I)
    text = re.sub(r"</h[1-6]>", "\n\n", text, flags=re.I)
    text = re.sub(r"<li>", "\n- ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(re.sub(r"\n{3,}", "\n\n", text)).strip()


def _rough_visible_text_length(html_doc: str) -> int:
    try:
        from lxml import html as lxml_html

        doc = lxml_html.fromstring(html_doc)
        for tag in ("script", "style", "noscript", "svg", "iframe"):
            for el in doc.xpath(f"//{tag}"):
                parent = el.getparent()
                if parent is not None:
                    parent.remove(el)
        panels = doc.xpath("//*[contains(@class,'panel')]")
        if panels:
            text = " ".join(" ".join(p.text_content().split()) for p in panels).split()
            return len(text)
        text = " ".join(doc.xpath("//body//text()")).split()
        return len(text)
    except Exception:
        return 0


def _extract_fallback_html(downloaded: str) -> tuple[str, str]:
    """trafilatura 正文過短時，以區塊/標題 heuristics 補強（行銷型首頁）。"""
    from lxml import html as lxml_html

    doc = lxml_html.fromstring(downloaded)
    for tag in ("script", "style", "noscript", "svg", "iframe", "form", "nav", "header", "footer"):
        for el in doc.xpath(f"//{tag}"):
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)

    roots = doc.xpath(
        "//*[contains(@class,'wapper') or contains(@id,'content') or self::main or self::article]"
    )
    root = doc.find(".//body")
    if root is None:
        root = doc
    elif roots:
        best = max(roots, key=lambda el: len(el.xpath(".//*[contains(@class,'panel')]")))
        if best.xpath(".//*[contains(@class,'panel')]"):
            root = best

    parts: list[str] = []
    seen: set[str] = set()
    block_xpath = (
        ".//*[contains(@class,'panel') or contains(@class,'editor') or self::section"
        " or self::article]"
    )
    for el in root.xpath(block_xpath):
        block_parts: list[str] = []
        for sub in el.xpath(".//h1|.//h2|.//h3|.//h4|.//p|.//li|.//a"):
            text = " ".join(sub.text_content().split())
            if len(text) < 4:
                continue
            tag = sub.tag.lower()
            if tag == "a" and len(text) < 15:
                continue
            if tag.startswith("h"):
                level = min(int(tag[1]), 3)
                block_parts.append(f"<h{level}>{html.escape(text)}</h{level}>")
            elif tag == "li":
                block_parts.append(f"<li>{html.escape(text)}</li>")
            elif tag == "a":
                block_parts.append(f"<p>{html.escape(text)}</p>")
            else:
                block_parts.append(f"<p>{html.escape(text)}</p>")

        if block_parts:
            chunk = "\n".join(block_parts)
        else:
            text = " ".join(el.text_content().split())
            if len(text) < 50:
                continue
            chunk = f"<p>{html.escape(text)}</p>"

        sig = re.sub(r"\s+", " ", _html_fragment_to_plain(chunk))[:250]
        if not sig or sig in seen:
            continue
        if sig.startswith("Designed by") or "隱私權政策" in sig:
            continue
        seen.add(sig)
        parts.append(chunk)

    if not parts:
        text = " ".join(root.text_content().split())
        if not text:
            return "", ""
        parts = [f"<p>{html.escape(text[:12000])}</p>"]

    content_html = "\n\n".join(parts)
    plain = _html_fragment_to_plain(content_html)
    return content_html, plain


def _extract_primary_html(downloaded: str, url: str) -> tuple[str, str]:
    import trafilatura

    content_html = trafilatura.extract(
        downloaded,
        url=url,
        include_tables=True,
        include_links=False,
        include_images=True,
        output_format="html",
        favor_recall=True,
    )
    plain = trafilatura.extract(
        downloaded,
        url=url,
        include_tables=True,
        output_format="txt",
        favor_recall=True,
    )
    if not content_html and plain:
        content_html = _text_to_simple_html(plain)
    content_html = _normalize_content_html(content_html or "")
    plain = (plain or _html_fragment_to_plain(content_html)).strip()
    return content_html, plain


def _fetch_web_preview_sync(url: str) -> WebPreview:
    import trafilatura
    from trafilatura.metadata import extract_metadata

    downloaded = trafilatura.fetch_url(url, no_ssl=False)
    if not downloaded:
        raise WebFetchError("無法取得網頁內容（請確認 URL 可公開存取）")

    content_html, plain = _extract_primary_html(downloaded, url)
    visible_len = _rough_visible_text_length(downloaded)
    too_short = len(plain) < 400 or (visible_len > 800 and len(plain) < visible_len * 0.08)

    if too_short:
        fb_html, fb_plain = _extract_fallback_html(downloaded)
        if len(fb_plain) > len(plain):
            logger.info(
                "web preview fallback: trafilatura=%d chars, fallback=%d chars, visible~=%d",
                len(plain),
                len(fb_plain),
                visible_len,
            )
            content_html, plain = fb_html, fb_plain

    if not (content_html or plain):
        raise WebFetchError(
            "無法從網頁抽取正文（可能為登入頁、純動態內容或反爬限制）。"
            "請改以 PDF 上傳，或稍後再試。"
        )

    if len(content_html) > _MAX_HTML_CHARS:
        raise WebFetchError("網頁正文過長，請改用 PDF 上傳或縮小頁面範圍")

    meta = extract_metadata(downloaded)
    title = (meta.title if meta and meta.title else "").strip() or _title_from_url(url)
    text_len = len(plain)

    return WebPreview(
        source_url=url,
        title=title[:200],
        content_html=content_html,
        preview_html=_wrap_preview_html(content_html, title, url),
        text_length=text_len,
        excerpt=plain[:400].strip(),
    )


def _html_to_plain_text(content_html: str) -> str:
    """將正文 HTML 轉為純文字（供結構化的中間表示）。"""
    import trafilatura

    normalized = _normalize_content_html(content_html)
    fragment_plain = _html_fragment_to_plain(normalized)
    wrapped = (
        f"<!DOCTYPE html><html><head><meta charset='utf-8'></head>"
        f"<body>{normalized}</body></html>"
    )
    traf_plain = trafilatura.extract(
        wrapped,
        output_format="txt",
        include_tables=True,
        include_links=False,
    )
    traf_plain = (traf_plain or "").strip()
    if len(fragment_plain) > len(traf_plain):
        plain = fragment_plain
    else:
        plain = traf_plain or fragment_plain
    if not plain:
        raise WebFetchError("無法從 HTML 取得文字")
    return plain


def _textbox_spare(
    text: str,
    *,
    font_path: Path,
    rect: object,
    fontname: str,
    fontsize: float = 11,
    lineheight: float = 1.35,
) -> float:
    import pymupdf as fitz

    tmp = fitz.open()
    try:
        page = tmp.new_page(width=595, height=842)
        if font_path.is_file() and fontname == "noto":
            page.insert_font(fontfile=str(font_path), fontname="noto")
        return page.insert_textbox(
            rect,
            text,
            fontname=fontname,
            fontsize=fontsize,
            lineheight=lineheight,
        )
    finally:
        tmp.close()


def _max_chars_for_textbox(
    text: str,
    *,
    font_path: Path,
    rect: object,
    fontname: str,
) -> int:
    if not text:
        return 0
    if _textbox_spare(text, font_path=font_path, rect=rect, fontname=fontname) >= 0:
        return len(text)
    lo, hi = 1, len(text)
    best = 0
    while lo <= hi:
        mid = (lo + hi) // 2
        if _textbox_spare(text[:mid], font_path=font_path, rect=rect, fontname=fontname) >= 0:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return max(best, 1)


def _write_paginated_text_pdf(body: str, *, font_path: Path) -> bytes:
    import pymupdf as fitz

    doc = fitz.open()
    try:
        width, height = fitz.paper_size("a4")
        margin = 48
        rect = fitz.Rect(margin, margin, width - margin, height - margin)
        fontname = "noto" if font_path.is_file() else "helv"
        remaining = body
        while remaining:
            fit_count = _max_chars_for_textbox(
                remaining,
                font_path=font_path,
                rect=rect,
                fontname=fontname,
            )
            page = doc.new_page(width=width, height=height)
            if font_path.is_file():
                page.insert_font(fontfile=str(font_path), fontname="noto")
            chunk = remaining[:fit_count]
            spare = page.insert_textbox(
                rect,
                chunk,
                fontname=fontname,
                fontsize=11,
                lineheight=1.35,
            )
            if spare < 0:
                logger.warning("web PDF textbox deficit %.2f after fit (%d chars)", spare, fit_count)
            remaining = remaining[fit_count:]
        return doc.tobytes()
    finally:
        doc.close()


def html_to_pdf_bytes(content_html: str, title: str) -> bytes:
    """將清洗後 HTML 轉為 PDF（供既有 PDF extract 管線使用）。

    Phase 1：以 UTF-8 文字寫入 PDF（良好文字層，避免 HTML 渲染兼容問題）。
    """
    if len(content_html) > _MAX_HTML_CHARS:
        raise WebFetchError("HTML 內容過大")

    plain = _html_to_plain_text(content_html)
    body = f"{title}\n\n{plain}"
    font_path = Path(__file__).resolve().parents[2] / "config" / "fonts" / "NotoSansTC-Regular.ttf"
    pdf_bytes = _write_paginated_text_pdf(body, font_path=font_path)
    if not pdf_bytes:
        raise WebFetchError("無法產生 PDF 快照")
    return pdf_bytes


_BLOCK_MD_TAGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6", "p", "li"})


def _collapse_blank_lines(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def html_fragment_to_markdown(fragment: str) -> str:
    """將正文 HTML 片段確定性轉為 Markdown（完整保留，不經 LLM）。"""
    from lxml import html as lxml_html

    normalized = _normalize_content_html(fragment)
    if not normalized.strip():
        return ""

    root = lxml_html.fromstring(f"<root>{normalized}</root>")
    lines: list[str] = []
    seen: set[str] = set()

    for el in root.iter():
        if not isinstance(el.tag, str) or el.tag.lower() not in _BLOCK_MD_TAGS:
            continue
        if any(
            isinstance(c.tag, str) and c.tag.lower() in _BLOCK_MD_TAGS
            for c in el.iterdescendants()
            if c is not el
        ):
            continue

        text = " ".join(el.text_content().split())
        if not text:
            continue

        tag = el.tag.lower()
        if tag.startswith("h"):
            level = min(int(tag[1]) + 1, 4)
            line = "#" * level + " " + text
        elif tag == "li":
            line = f"- {text}"
        else:
            line = text

        if line in seen:
            continue
        seen.add(line)
        lines.append(line)
        if tag.startswith("h") or tag == "p":
            lines.append("")

    return _collapse_blank_lines("\n".join(lines))


def build_web_structured_markdown(
    content_html: str,
    *,
    title: str,
    original_file: str,
    source_url: str,
) -> str:
    """網頁正文 → YAML front matter + Markdown（確定性，不走 PDF / LLM）。"""
    from app.services.document_structuring.enrich import enrich

    body = html_fragment_to_markdown(content_html)
    if not body:
        raise WebFetchError("無法從 HTML 產生 Markdown")

    safe_title = title.strip()
    if safe_title:
        title_line = f"# {safe_title}"
        if not body.startswith(title_line):
            body = f"{title_line}\n\n{body}"

    return enrich(
        body,
        title=safe_title or "webpage",
        original_file=original_file,
        source="doc-refiner-web-md",
        source_url=source_url,
    )


async def fetch_web_preview(url: str) -> WebPreview:
    normalized = validate_public_url(url)
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_executor, _fetch_web_preview_sync, normalized)


async def html_to_pdf_bytes_async(content_html: str, title: str) -> bytes:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_executor, html_to_pdf_bytes, content_html, title)


async def html_to_plain_text_async(content_html: str) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_executor, _html_to_plain_text, content_html)


async def build_web_structured_markdown_async(
    content_html: str,
    *,
    title: str,
    original_file: str,
    source_url: str,
) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _executor,
        lambda: build_web_structured_markdown(
            content_html,
            title=title,
            original_file=original_file,
            source_url=source_url,
        ),
    )
