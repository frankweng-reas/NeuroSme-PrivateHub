"""LLM API Key 加密工具（Fernet 對稱加密）

金鑰來源：settings.LLM_ENCRYPTION_KEY（32 bytes URL-safe base64）
未設定時自動使用以 SHA-256 衍生的固定 fallback key（僅適合開發環境）。
"""
import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

logger = logging.getLogger(__name__)

_FALLBACK_WARNING_ISSUED = False


def _get_fernet() -> Fernet:
    global _FALLBACK_WARNING_ISSUED
    raw_key = settings.LLM_ENCRYPTION_KEY
    if raw_key:
        return Fernet(raw_key.encode() if isinstance(raw_key, str) else raw_key)
    if not _FALLBACK_WARNING_ISSUED:
        logger.warning(
            "LLM_ENCRYPTION_KEY 未設定，使用不安全的預設金鑰。"
            "請在 .env 中設定 LLM_ENCRYPTION_KEY（執行 python -c "
            "'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())' 產生）"
        )
        _FALLBACK_WARNING_ISSUED = True
    digest = hashlib.sha256(b"neurosme-default-insecure-llm-key").digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_api_key(plaintext: str) -> str:
    """加密 API Key，回傳 Fernet token（字串）"""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    """解密 Fernet token，回傳明文；解密失敗拋出 ValueError"""
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as e:
        raise ValueError("API Key 解密失敗，請確認 LLM_ENCRYPTION_KEY 是否與加密時相同") from e


def mask_api_key(plaintext: str) -> str:
    """顯示用：遮蔽中段，僅保留前 4 後 4"""
    if not plaintext:
        return ""
    if len(plaintext) <= 8:
        return "****"
    return plaintext[:4] + "****" + plaintext[-4:]
