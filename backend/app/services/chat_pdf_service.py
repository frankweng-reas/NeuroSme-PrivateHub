"""Chat PDF 匯出服務：Markdown → 有文字層的 PDF（reportlab + NotoSansTC）"""
import io
import logging
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger(__name__)

_FONT_DIR = Path(__file__).parent.parent.parent / "config" / "fonts"
_FONT_NAME = "NotoSansTC"
_FONT_REGISTERED = False


def _ensure_font() -> None:
    global _FONT_REGISTERED
    if _FONT_REGISTERED:
        return
    font_path = _FONT_DIR / "NotoSansTC-Regular.ttf"
    if not font_path.exists():
        raise FileNotFoundError(f"字型檔不存在：{font_path}")
    pdfmetrics.registerFont(TTFont(_FONT_NAME, str(font_path)))
    _FONT_REGISTERED = True


def _build_styles() -> dict:
    _ensure_font()
    base = dict(fontName=_FONT_NAME, leading=20)
    return {
        "normal": ParagraphStyle("normal", **base, fontSize=11, spaceAfter=6),
        "h1": ParagraphStyle("h1", **base, fontSize=18, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#111827")),
        "h2": ParagraphStyle("h2", **base, fontSize=15, spaceBefore=12, spaceAfter=4, textColor=colors.HexColor("#1f2937")),
        "h3": ParagraphStyle("h3", **base, fontSize=13, spaceBefore=10, spaceAfter=3, textColor=colors.HexColor("#374151")),
        "code": ParagraphStyle(
            "code",
            fontName="Courier",
            fontSize=9,
            leading=14,
            backColor=colors.HexColor("#f3f4f6"),
            leftIndent=8,
            rightIndent=8,
            spaceBefore=4,
            spaceAfter=4,
        ),
        "th": ParagraphStyle("th", **base, fontSize=10, textColor=colors.white),
        "td": ParagraphStyle("td", **base, fontSize=10),
    }


def _escape(text: str) -> str:
    """Reportlab Paragraph 特殊字元跳脫。"""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _md_inline(text: str, font: str = _FONT_NAME) -> str:
    """將 inline markdown（**bold**、`code`）轉為 reportlab XML 標記。"""
    # bold
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"__(.+?)__", r"<b>\1</b>", text)
    # italic
    text = re.sub(r"\*(.+?)\*", r"<i>\1</i>", text)
    text = re.sub(r"_(.+?)_", r"<i>\1</i>", text)
    # inline code
    text = re.sub(r"`([^`]+)`", lambda m: f'<font name="Courier" size="9">{_escape(m.group(1))}</font>', text)
    return text


def _parse_table(lines: list[str], styles: dict) -> Table | None:
    """將 markdown 表格行轉為 reportlab Table。"""
    rows = []
    for line in lines:
        if re.match(r"^\|[-| :]+\|$", line.strip()):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows.append(cells)
    if not rows:
        return None

    style_list = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#374151")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), _FONT_NAME),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]

    # 欄寬平均分配
    col_count = max(len(r) for r in rows)
    page_w = A4[0] - 40 * mm
    col_w = page_w / col_count if col_count else page_w

    para_rows = []
    for ri, row in enumerate(rows):
        s = styles["th"] if ri == 0 else styles["td"]
        para_rows.append([Paragraph(_escape(c), s) for c in row])

    return Table(para_rows, colWidths=[col_w] * col_count, style=TableStyle(style_list), hAlign="LEFT")


def markdown_to_pdf_bytes(markdown_text: str, title: str = "Chat Export") -> bytes:
    """將 Markdown 字串轉為含文字層的 PDF bytes（reportlab 生成）。"""
    styles = _build_styles()
    story: list = []
    lines = markdown_text.splitlines()

    in_code_block = False
    code_lines: list[str] = []
    in_table = False
    table_lines: list[str] = []
    list_stack: list[tuple[int, str, list]] = []  # (indent, marker, items)

    def flush_code():
        nonlocal code_lines
        if code_lines:
            txt = _escape("\n".join(code_lines))
            story.append(Paragraph(txt.replace("\n", "<br/>"), styles["code"]))
            story.append(Spacer(1, 4))
            code_lines = []

    def flush_table():
        nonlocal table_lines
        if table_lines:
            tbl = _parse_table(table_lines, styles)
            if tbl:
                story.append(tbl)
                story.append(Spacer(1, 6))
            table_lines = []

    def flush_lists():
        nonlocal list_stack
        if not list_stack:
            return
        # flatten all as one ListFlowable
        items = []
        for _, _, lst_items in list_stack:
            items.extend(lst_items)
        story.append(ListFlowable(items, bulletType="bullet", leftIndent=16, spaceBefore=2, spaceAfter=6))
        list_stack.clear()

    for line in lines:
        # Code block fence
        if line.strip().startswith("```"):
            if in_code_block:
                flush_code()
                in_code_block = False
            else:
                flush_lists()
                flush_table()
                in_code_block = True
            continue

        if in_code_block:
            code_lines.append(line)
            continue

        # Table row
        if line.strip().startswith("|"):
            flush_lists()
            in_table = True
            table_lines.append(line)
            continue
        elif in_table:
            flush_table()
            in_table = False

        # Blank line
        if not line.strip():
            flush_lists()
            story.append(Spacer(1, 4))
            continue

        # Headings
        h_match = re.match(r"^(#{1,3})\s+(.*)", line)
        if h_match:
            flush_lists()
            level = len(h_match.group(1))
            text = _escape(h_match.group(2))
            s = styles.get(f"h{level}", styles["h3"])
            story.append(Paragraph(_md_inline(text), s))
            if level <= 2:
                story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e5e7eb"), spaceAfter=4))
            continue

        # Horizontal rule
        if re.match(r"^[-*_]{3,}$", line.strip()):
            flush_lists()
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#d1d5db")))
            story.append(Spacer(1, 4))
            continue

        # Unordered list
        ul_match = re.match(r"^(\s*)[-*+]\s+(.*)", line)
        if ul_match:
            text = _escape(ul_match.group(2))
            list_stack.append((len(ul_match.group(1)), "bullet", [
                ListItem(Paragraph(_md_inline(text), styles["normal"]), leftIndent=16)
            ]))
            continue

        # Ordered list
        ol_match = re.match(r"^(\s*)\d+\.\s+(.*)", line)
        if ol_match:
            text = _escape(ol_match.group(2))
            list_stack.append((len(ol_match.group(1)), "1", [
                ListItem(Paragraph(_md_inline(text), styles["normal"]), leftIndent=16)
            ]))
            continue

        # Normal paragraph
        flush_lists()
        text = _escape(line)
        story.append(Paragraph(_md_inline(text), styles["normal"]))

    # Flush remaining
    flush_code()
    flush_table()
    flush_lists()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=title,
        author="NeuroSme",
    )
    doc.build(story)
    return buf.getvalue()
