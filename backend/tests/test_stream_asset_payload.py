from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.models.database import Asset
from app.services.streams.helpers import build_asset_payload


def _asset_meta() -> dict:
    return {
        "video": {
            "codec": "h264",
            "width": 1920,
            "height": 1080,
            "fps": 30,
        },
        "audio": {
            "codec": "aac",
            "sample_rate": 48000,
            "channels": 2,
        },
    }


def test_build_asset_payload_returns_resolved_filesystem_path(tmp_path):
    user_id = uuid4()
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    asset_path = user_dir / "clip.mp4"
    asset_path.write_text("video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        asset = Asset(
            id=uuid4(),
            user_id=user_id,
            filename="clip.mp4",
            storage_path=str(asset_path),
            storage_backend="filesystem",
            size_bytes=asset_path.stat().st_size,
            asset_type="video",
            meta=_asset_meta(),
            compatible_for_copy=True,
            validation_errors=[],
        )

        payload = build_asset_payload(asset)

        assert payload["path"] == str(asset_path.resolve())
        assert payload["storage_backend"] == "filesystem"
        assert payload["local_file_available"] is True
    finally:
        settings.upload_dir = original_upload_dir


def test_build_asset_payload_rejects_remote_asset_without_local_cache(tmp_path):
    user_id = uuid4()
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    cache_path = user_dir / "remote.mp4"

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        asset = Asset(
            id=uuid4(),
            user_id=user_id,
            filename="remote.mp4",
            storage_path=str(cache_path),
            storage_backend="object_storage",
            storage_key="assets/remote.mp4",
            size_bytes=1024,
            asset_type="video",
            meta=_asset_meta(),
            compatible_for_copy=True,
            validation_errors=[],
        )

        with pytest.raises(HTTPException) as exc_info:
            build_asset_payload(asset)

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["error"] == "asset_local_file_unavailable"
    finally:
        settings.upload_dir = original_upload_dir
