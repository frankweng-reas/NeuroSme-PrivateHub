"""public_vision API helpers"""
import sys

sys.path.insert(0, ".")

from app.api.endpoints.public_vision import _guess_mime


def test_guess_mime_from_extension():
    assert _guess_mime("scan.png", None) == "image/png"
    assert _guess_mime("photo.JPG", "application/octet-stream") == "image/jpeg"
    assert _guess_mime("x.webp", None) == "image/webp"


def test_guess_mime_from_content_type():
    assert _guess_mime("blob", "image/png") == "image/png"
    assert _guess_mime("blob", "image/jpg") == "image/jpeg"


def test_guess_mime_unknown():
    assert _guess_mime("file.bin", "application/octet-stream") == ""
