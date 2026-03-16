"""bi_sources 共用：取得專案合併後的 CSV 內容"""
import re
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.bi_source import BiSource


def get_merged_csv_for_project(db: Session, project_id: str) -> str:
    """
    取得專案 is_selected 來源的合併 CSV。
    與 chat 的 _get_bi_sources_content + _extract_and_merge_csv_blocks 邏輯一致。
    """
    try:
        pid = UUID(project_id)
    except ValueError:
        return ""
    rows = (
        db.query(BiSource.file_name, BiSource.content)
        .filter(BiSource.project_id == pid, BiSource.is_selected.is_(True))
        .order_by(BiSource.file_name)
        .all()
    )
    parts = []
    for file_name, content in rows:
        if content and content.strip():
            parts.append(f"--- 檔名：{file_name} ---\n{content.strip()}")
    raw = "\n\n".join(parts)
    return _extract_and_merge_csv_blocks(raw)


def _extract_and_merge_csv_blocks(raw: str) -> str:
    """從 bi_sources 拼接字串中取出所有 CSV 區塊並合併"""
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
