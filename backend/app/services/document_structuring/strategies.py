import re

CHUNK_SIZE = 20_000
CHUNK_OVERLAP = 300


def split_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """依字數切分文字，超過 chunk_size 才切；相鄰段落保留 overlap 重疊。"""
    if len(text) <= chunk_size:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        if end < len(text):
            break_pos = text.rfind("\n", start + chunk_size // 2, end)
            if break_pos > start:
                end = break_pos + 1
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - overlap
    return chunks


def strip_md_fence(text: str) -> str:
    """移除 LLM 可能包的 ```markdown ... ``` fence。"""
    text = re.sub(r"^```(?:markdown)?\s*\n?", "", text.strip(), flags=re.IGNORECASE)
    text = re.sub(r"\n?```\s*$", "", text.strip())
    return text.strip()


def build_llm_user_prompt(*, title: str, chunk_text: str, chunk_index: int, chunk_total: int) -> str:
    suffix = f"（第 {chunk_index}/{chunk_total} 段）" if chunk_total > 1 else ""
    return (
        f"請將以下文件內容結構化為 Markdown，加上 ##/### 章節標題。\n"
        f"文件名稱：{title}{suffix}\n\n"
        f"--- 文件內容開始 ---\n{chunk_text}\n--- 文件內容結束 ---"
    )
