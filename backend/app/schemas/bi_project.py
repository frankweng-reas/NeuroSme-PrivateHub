"""BiProject API 結構"""
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class BiProjectCreate(BaseModel):
    agent_id: str = Field(..., description="agent 識別")
    project_name: str = Field(..., max_length=255)
    project_desc: str | None = Field(None, max_length=2000)


class BiProjectUpdate(BaseModel):
    project_name: str | None = Field(None, max_length=255)
    project_desc: str | None = Field(None, max_length=2000)
    conversation_data: list[dict[str, Any]] | None = Field(None, description="對話紀錄 JSON 陣列")
    schema_id: str | None = Field(
        None,
        description="bi_schemas 主鍵 id；傳 null 或空字串可清除專案綁定",
        max_length=100,
    )
    project_config: dict[str, Any] | None = Field(
        None,
        description="per-project AI 設定（userPrompt、suggestedFollowUpCount、sampleQuestions）",
    )


class BiProjectResponse(BaseModel):
    project_id: UUID
    project_name: str
    project_desc: str | None
    created_at: datetime
    user_id: str | None = Field(None, description="建立者 user_id")
    conversation_data: list[dict[str, Any]] | None = None
    schema_id: str | None = Field(
        None,
        description="bi_schemas 主鍵 id（非 name）；匯入 CSV 成功後由後端寫入",
    )
    project_config: dict[str, Any] | None = Field(
        None,
        description="per-project AI 設定（userPrompt、suggestedFollowUpCount、sampleQuestions、sharedWith）",
    )

    class Config:
        from_attributes = True
