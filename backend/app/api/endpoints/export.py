"""匯出 API：POST /export/chat-pdf — Markdown → 含文字層 PDF"""
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.chat_pdf_service import markdown_to_pdf_bytes

logger = logging.getLogger(__name__)
router = APIRouter()


class ChatPdfRequest(BaseModel):
    content: str
    filename: str = "chat-export"


@router.post("/chat-pdf")
async def export_chat_pdf(
    req: ChatPdfRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """將 Markdown 內容轉為含文字層的 PDF 並回傳下載。"""
    pdf_bytes = markdown_to_pdf_bytes(req.content, title=req.filename)
    safe_name = req.filename.replace('"', "").replace("\\", "") or "chat-export"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
    )
