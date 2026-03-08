"""QtnSource API 結構"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class QtnSourceCreate(BaseModel):
    project_id: str = Field(..., description="專案 UUID")
    source_type: str = Field(..., description="OFFERING | REQUIREMENT")
    file_name: str = Field(..., max_length=255)
    content: str | None = Field(None, description="檔案或文字內容，可為空")


class QtnSourceResponse(BaseModel):
    source_id: str
    project_id: str
    source_type: str
    file_name: str
    content: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class QtnSourceUpdate(BaseModel):
    file_name: str | None = Field(None, max_length=255, description="新檔名")
    content: str | None = Field(None, description="更新內容")
