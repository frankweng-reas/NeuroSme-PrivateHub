from datetime import date


def build_front_matter(
    *,
    title: str,
    original_file: str,
    source: str = "doc-refiner-md",
    doc_date: str | None = None,
    ocr_pages: list[int] | None = None,
    source_url: str | None = None,
) -> str:
    """產生 YAML front matter 區塊（含結尾 --- 與 trailing newline）。"""
    d = doc_date or date.today().isoformat()
    safe_title = title.replace("\n", " ").strip()
    safe_file = original_file.replace("\n", " ").strip()
    lines = [
        "---",
        f"source: {source}",
        f"title: {safe_title}",
        f"date: {d}",
        f"original_file: {safe_file}",
    ]
    if source_url:
        lines.append(f"source_url: {source_url.replace(chr(10), ' ').strip()}")
    if ocr_pages:
        pages_str = ", ".join(str(p) for p in sorted(ocr_pages))
        lines.append(f"ocr_pages: [{pages_str}]")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def enrich(
    body: str,
    *,
    title: str,
    original_file: str,
    source: str = "doc-refiner-md",
    doc_date: str | None = None,
    ocr_pages: list[int] | None = None,
    source_url: str | None = None,
) -> str:
    """在 MD 正文前插入 YAML front matter。"""
    body = body.strip()
    fm = build_front_matter(
        title=title,
        original_file=original_file,
        source=source,
        doc_date=doc_date,
        ocr_pages=ocr_pages,
        source_url=source_url,
    )
    return fm + body
