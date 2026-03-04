"""PromptTemplate API 結構"""
from datetime import datetime

from pydantic import BaseModel, Field


class PromptTemplateCreate(BaseModel):
    agent_id: str = Field(..., description="agent 識別，支援 tenant_id:id 或 id")
    name: str = Field(..., max_length=255, description="範本名稱")
    content: str = Field(..., description="User Prompt 內容")


class PromptTemplateResponse(BaseModel):
    id: int
    name: str
    content: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PromptTemplateUpdate(BaseModel):
    name: str | None = Field(None, max_length=255, description="範本名稱")
    content: str | None = Field(None, description="User Prompt 內容")
