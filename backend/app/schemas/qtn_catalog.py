"""QtnCatalog API 結構"""
from datetime import datetime

from pydantic import BaseModel, Field


class QtnCatalogCreate(BaseModel):
    catalog_name: str = Field(..., max_length=255)
    content: str = Field(..., description="CSV 或文字內容")
    is_default: bool = Field(False, description="是否為該公司的預設清單")


class QtnCatalogResponse(BaseModel):
    catalog_id: str
    tenant_id: str
    catalog_name: str
    content: str | None
    is_default: bool
    created_at: datetime

    class Config:
        from_attributes = True
