from dataclasses import dataclass, field
from typing import Literal

SourceFormat = Literal["pdf", "docx", "txt", "unknown"]


@dataclass
class ExtractResult:
    text: str
    page_count: int
    source_format: SourceFormat
    filename: str
    title: str
    ocr_pages: list[int] = field(default_factory=list)
