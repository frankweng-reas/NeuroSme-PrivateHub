"""document_structuring 模組測試"""
import sys

sys.path.insert(0, ".")

from app.services.document_structuring.enrich import enrich
from app.services.document_service import extract_txt, is_supported_filename
from app.services.document_structuring.strategies import split_text, strip_md_fence


def test_enrich_front_matter():
    result = enrich("## Hello", title="測試文件", original_file="test.pdf")
    assert result.startswith("---\n")
    assert "source: doc-refiner-md" in result
    assert "title: 測試文件" in result
    assert "original_file: test.pdf" in result
    assert "## Hello" in result


def test_enrich_with_ocr_pages():
    result = enrich("body", title="t", original_file="a.pdf", ocr_pages=[2, 5])
    assert "ocr_pages: [2, 5]" in result


def test_meanful_char_count():
    from app.services.document_service import _meaningful_char_count

    assert _meaningful_char_count("hello world") == 10
    assert _meaningful_char_count("   ") == 0


def test_is_bogus_ocr_text():
    from app.services.document_service import _is_bogus_ocr_text

    assert _is_bogus_ocr_text("") is True
    assert _is_bogus_ocr_text("由於您尚未提供需要轉錄的圖片，請上傳圖片") is True
    assert _is_bogus_ocr_text("主管溝通準則：情緒拉低了，就容易濫用。") is False


def test_embedded_image_worth_ocr():
    from app.services.document_service import _embedded_image_worth_ocr

    page_area = 595 * 842
    assert _embedded_image_worth_ocr(50 * 50, 50, page_area) is False
    assert _embedded_image_worth_ocr(200 * 200, 200, page_area) is True


def test_mime_from_image_ext():
    from app.services.document_service import _mime_from_image_ext

    assert _mime_from_image_ext("jpg") == "image/jpeg"
    assert _mime_from_image_ext("png") == "image/png"


def test_extract_txt():
    text, page_count = extract_txt("Hello\n\nWorld".encode("utf-8"))
    assert "Hello" in text
    assert page_count >= 1


def test_is_supported_filename():
    assert is_supported_filename("a.pdf")
    assert not is_supported_filename("b.docx")
    assert not is_supported_filename("c.xlsx")


def test_split_text_small():
    chunks = split_text("short text")
    assert chunks == ["short text"]


def test_strip_md_fence():
    raw = "```markdown\n## Title\n```"
    assert strip_md_fence(raw) == "## Title"
