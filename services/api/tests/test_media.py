import asyncio
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile

from app import media


def test_upload_has_no_application_size_cap_when_configured_as_zero(tmp_path, monkeypatch):
    monkeypatch.setattr(media.settings, "storage_path", tmp_path)
    monkeypatch.setattr(media.settings, "max_upload_size_mb", 0)
    payload = b"x" * (1024 * 1024 + 1)
    upload = UploadFile(file=BytesIO(payload), filename="large.wav")

    asset_id, path, size = asyncio.run(media.store_upload(upload))

    assert len(asset_id) == 36
    assert size == len(payload)
    assert path.read_bytes() == payload


def test_upload_enforces_positive_application_size_cap(tmp_path, monkeypatch):
    monkeypatch.setattr(media.settings, "storage_path", tmp_path)
    monkeypatch.setattr(media.settings, "max_upload_size_mb", 1)
    payload = b"x" * (1024 * 1024 + 1)
    upload = UploadFile(file=BytesIO(payload), filename="too-large.wav")

    with pytest.raises(HTTPException) as error:
        asyncio.run(media.store_upload(upload))

    assert error.value.status_code == 413
    assert not list(tmp_path.iterdir())
