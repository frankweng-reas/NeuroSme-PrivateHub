"""QtnProject API 結構"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class QtnProjectCreate(BaseModel):
    agent_id: str = Field(..., description="agent 識別")
    project_name: str = Field(..., max_length=255)
    project_desc: str | None = Field(None, max_length=2000)


class QtnProjectResponse(BaseModel):
    project_id: UUID
    project_name: str
    project_desc: str | None
    created_at: datetime

    class Config:
        from_attributes = True
