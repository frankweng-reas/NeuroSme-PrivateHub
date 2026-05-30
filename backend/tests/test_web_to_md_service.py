"""web_to_md_service 測試"""
import pytest

from app.services.web_to_md_service import (
    WebFetchError,
    build_web_structured_markdown,
    html_to_pdf_bytes,
    validate_public_url,
    _extract_fallback_html,
    _normalize_content_html,
    _text_to_simple_html,
    _wrap_preview_html,
    html_fragment_to_markdown,
)


def test_validate_public_url_requires_scheme():
    with pytest.raises(WebFetchError, match="http"):
        validate_public_url("example.com")


def test_validate_public_url_blocks_localhost():
    with pytest.raises(WebFetchError):
        validate_public_url("http://localhost/page")


def test_validate_public_url_blocks_private_ip():
    with pytest.raises(WebFetchError):
        validate_public_url("http://127.0.0.1/secret")


def test_validate_public_url_accepts_https():
    assert validate_public_url("https://example.com/docs") == "https://example.com/docs"


def test_text_to_simple_html():
    html_out = _text_to_simple_html("Hello\n\nWorld")
    assert "<p>Hello</p>" in html_out
    assert "<p>World</p>" in html_out


def test_wrap_preview_html_contains_source():
    wrapped = _wrap_preview_html("<p>正文</p>", "標題", "https://example.com/a")
    assert "example.com" in wrapped
    assert "正文" in wrapped


def test_html_to_pdf_bytes_produces_pdf():
    pdf = html_to_pdf_bytes("<h2>章節</h2><p>測試內容</p>", "測試")
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 100


def test_html_to_pdf_bytes_text_is_extractable():
    import pymupdf as fitz

    long_body = "測試內容，" * 400
    pdf = html_to_pdf_bytes(f"<p>{long_body}</p>", "長文測試")
    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        extracted = "".join(page.get_text() for page in doc)
    finally:
        doc.close()
    assert "測試內容" in extracted
    assert len(extracted) > 500


def test_html_to_plain_text():
    from app.services.web_to_md_service import _html_to_plain_text

    plain = _html_to_plain_text("<p>Hello</p><table><tr><td>A</td></tr></table>")
    assert "Hello" in plain


def test_normalize_content_html_strips_document_wrapper():
    wrapped = "<html><body><p>正文</p></body></html>"
    assert _normalize_content_html(wrapped) == "<p>正文</p>"


def test_wrap_preview_html_avoids_nested_body():
    wrapped = _wrap_preview_html(
        "<html><body><p>正文</p></body></html>",
        "標題",
        "https://example.com/a",
    )
    assert wrapped.count("<body>") == 1
    assert "正文" in wrapped


CHAGE_LIKE_HTML = """
<html><body>
<div class="panel">
  <h1 class="main-title">熱銷產品</h1><h2>Hot products</h2>
  <section class="boxContent">
    <h3>香片姍姍</h3>
    <a href="#">2021榮獲iTi比利時風味絕佳獎二星等級殊榮，一層茶一層花</a>
  </section>
  <section class="boxContent">
    <h3>膠原戀檸C</h3>
    <a href="#">無咖啡因，嚴選屏東檸檬特調</a>
  </section>
</div>
<div class="panel">
  <h1 class="main-title">最新消息</h1>
  <p>香片領導品牌—蘋安紅 2026-01-01</p>
</div>
</body></html>
"""


def test_extract_fallback_html_marketing_page():
    content_html, plain = _extract_fallback_html(CHAGE_LIKE_HTML)
    assert "熱銷產品" in plain
    assert "iTi" in plain
    assert "香片姍姍" in plain
    assert "最新消息" in plain
    assert "蘋安紅" in plain
    assert "<html" not in content_html.lower()


def test_html_fragment_to_markdown_preserves_products():
    content_html, _ = _extract_fallback_html(CHAGE_LIKE_HTML)
    md = html_fragment_to_markdown(content_html)
    assert "## 熱銷產品" in md
    assert "iTi" in md
    assert "膠原戀檸C" in md


def test_build_web_structured_markdown_has_front_matter():
    content_html, _ = _extract_fallback_html(CHAGE_LIKE_HTML)
    md = build_web_structured_markdown(
        content_html,
        title="茶聚",
        original_file="https://www.chage.com.tw/",
        source_url="https://www.chage.com.tw/",
    )
    assert md.startswith("---\nsource: doc-refiner-web-md")
    assert "source_url:" in md
    assert "# 茶聚" in md
    assert "iTi" in md
    assert "蘋安紅" in md
