import base64
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services.assets import utils as asset_utils


def test_upload_token_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    base_time = 1_700_000_000
    monkeypatch.setattr(asset_utils.time, "time", lambda: base_time)

    user_id = uuid4()
    token, _ = asset_utils.generate_upload_token(user_id)

    assert asset_utils.verify_upload_token(token) == user_id


def test_upload_token_strips_whitespace(monkeypatch: pytest.MonkeyPatch) -> None:
    base_time = 1_700_000_000
    monkeypatch.setattr(asset_utils.time, "time", lambda: base_time)

    user_id = uuid4()
    token, _ = asset_utils.generate_upload_token(user_id)

    assert asset_utils.verify_upload_token(f"  {token}\n") == user_id


def test_upload_token_rejects_invalid_base64() -> None:
    with pytest.raises(HTTPException) as exc_info:
        asset_utils.verify_upload_token("not base64!!!")

    assert exc_info.value.status_code == 403


def test_upload_token_rejects_invalid_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    base_time = 1_700_000_000
    monkeypatch.setattr(asset_utils.time, "time", lambda: base_time)

    user_id = uuid4()
    token, _ = asset_utils.generate_upload_token(user_id)

    decoded = base64.b64decode(token.encode("utf-8")).decode("utf-8")
    payload, signature = decoded.rsplit(":", 1)
    flipped = ("0" if signature[0] != "0" else "1") + signature[1:]
    tampered = base64.b64encode(f"{payload}:{flipped}".encode("utf-8")).decode("utf-8")

    with pytest.raises(HTTPException) as exc_info:
        asset_utils.verify_upload_token(tampered)

    assert exc_info.value.status_code == 403


def test_upload_token_rejects_expired_token(monkeypatch: pytest.MonkeyPatch) -> None:
    base_time = 1_700_000_000
    monkeypatch.setattr(asset_utils.time, "time", lambda: base_time)

    user_id = uuid4()
    token, expires_at = asset_utils.generate_upload_token(user_id)
    monkeypatch.setattr(asset_utils.time, "time", lambda: expires_at + 1)

    with pytest.raises(HTTPException) as exc_info:
        asset_utils.verify_upload_token(token)

    assert exc_info.value.status_code == 403


def test_upload_token_rejects_missing_nonce(monkeypatch: pytest.MonkeyPatch) -> None:
    base_time = 1_700_000_000
    monkeypatch.setattr(asset_utils.time, "time", lambda: base_time)

    user_id = uuid4()
    expires_at = base_time + 60
    payload = f"{user_id}:{expires_at}"
    signature = asset_utils._sign_upload_payload(payload)
    token = base64.b64encode(f"{payload}:{signature}".encode("utf-8")).decode("utf-8")

    with pytest.raises(HTTPException) as exc_info:
        asset_utils.verify_upload_token(token)

    assert exc_info.value.status_code == 403


def test_download_token_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    base_time = 1_700_000_000
    monkeypatch.setattr(asset_utils.time, "time", lambda: base_time)

    asset_id = uuid4()
    user_id = uuid4()
    token, expires_at = asset_utils.generate_download_token(asset_id, user_id)

    parsed_asset_id, parsed_user_id, parsed_expires_at = asset_utils.parse_download_token(token)

    assert parsed_asset_id == asset_id
    assert parsed_user_id == user_id
    assert parsed_expires_at == expires_at


def test_download_token_strips_whitespace(monkeypatch: pytest.MonkeyPatch) -> None:
    base_time = 1_700_000_000
    monkeypatch.setattr(asset_utils.time, "time", lambda: base_time)

    asset_id = uuid4()
    user_id = uuid4()
    token, _ = asset_utils.generate_download_token(asset_id, user_id)

    parsed_asset_id, parsed_user_id, _ = asset_utils.parse_download_token(f"\n{token}  ")

    assert parsed_asset_id == asset_id
    assert parsed_user_id == user_id


def test_download_token_rejects_invalid_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    base_time = 1_700_000_000
    monkeypatch.setattr(asset_utils.time, "time", lambda: base_time)

    asset_id = uuid4()
    user_id = uuid4()
    token, _ = asset_utils.generate_download_token(asset_id, user_id)

    decoded = base64.urlsafe_b64decode(token.encode("utf-8")).decode("utf-8")
    payload, signature = decoded.rsplit(":", 1)
    flipped = ("0" if signature[0] != "0" else "1") + signature[1:]
    tampered = base64.urlsafe_b64encode(f"{payload}:{flipped}".encode("utf-8")).decode(
        "utf-8"
    )

    with pytest.raises(HTTPException) as exc_info:
        asset_utils.parse_download_token(tampered)

    assert exc_info.value.status_code == 400


def test_download_token_rejects_expired_token(monkeypatch: pytest.MonkeyPatch) -> None:
    base_time = 1_700_000_000
    monkeypatch.setattr(asset_utils.time, "time", lambda: base_time)

    asset_id = uuid4()
    user_id = uuid4()
    token, expires_at = asset_utils.generate_download_token(asset_id, user_id)
    monkeypatch.setattr(asset_utils.time, "time", lambda: expires_at + 1)

    with pytest.raises(HTTPException) as exc_info:
        asset_utils.parse_download_token(token)

    assert exc_info.value.status_code == 400


def test_download_token_rejects_invalid_format() -> None:
    token = base64.urlsafe_b64encode(b"bad:format").decode("utf-8")

    with pytest.raises(HTTPException) as exc_info:
        asset_utils.parse_download_token(token)

    assert exc_info.value.status_code == 400
