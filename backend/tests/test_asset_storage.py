from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.models.database import Asset
from app.services.assets.storage import (
    get_asset_storage_backend,
    get_asset_storage_key,
    resolve_asset_local_path,
)


def test_filesystem_asset_resolves_to_same_local_path(tmp_path):
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
            user_id=user_id,
            filename="clip.mp4",
            storage_path=str(asset_path),
            size_bytes=asset_path.stat().st_size,
            asset_type="video",
        )

        resolved = resolve_asset_local_path(asset, user_id, must_exist=True)

        assert resolved == asset_path.resolve()
        assert get_asset_storage_backend(asset) == "filesystem"
        assert get_asset_storage_key(asset) == str(asset_path.resolve())
    finally:
        settings.upload_dir = original_upload_dir


def test_storage_path_outside_user_root_is_rejected(tmp_path):
    user_id = uuid4()
    upload_root = tmp_path / "uploads"
    upload_root.mkdir(parents=True, exist_ok=True)
    outside_path = tmp_path / "elsewhere" / "clip.mp4"
    outside_path.parent.mkdir(parents=True, exist_ok=True)
    outside_path.write_text("video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        asset = Asset(
            user_id=user_id,
            filename="clip.mp4",
            storage_path=str(outside_path),
            size_bytes=outside_path.stat().st_size,
            asset_type="video",
        )

        with pytest.raises(HTTPException) as exc_info:
            resolve_asset_local_path(asset, user_id, must_exist=True)

        assert exc_info.value.status_code == 400
        assert (
            exc_info.value.detail
            == "Asset storage_path must be within the user's upload directory"
        )
    finally:
        settings.upload_dir = original_upload_dir


def test_missing_filesystem_asset_preserves_404_semantics(tmp_path):
    user_id = uuid4()
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    asset_path = user_dir / "missing.mp4"

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        asset = Asset(
            user_id=user_id,
            filename="missing.mp4",
            storage_path=str(asset_path),
            size_bytes=1024,
            asset_type="video",
        )

        with pytest.raises(HTTPException) as exc_info:
            resolve_asset_local_path(asset, user_id, must_exist=True)

        assert exc_info.value.status_code == 404
        assert exc_info.value.detail == "Asset file missing on disk"
    finally:
        settings.upload_dir = original_upload_dir


def test_legacy_app_upload_path_is_remapped_into_current_user_root(tmp_path):
    user_id = uuid4()
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    remapped_path = user_dir / "legacy.mp4"
    remapped_path.write_text("video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        asset = Asset(
            user_id=user_id,
            filename="legacy.mp4",
            storage_path=f"/app/uploads/{user_id}/legacy.mp4",
            size_bytes=remapped_path.stat().st_size,
            asset_type="video",
        )

        resolved = resolve_asset_local_path(asset, user_id, must_exist=True)

        assert resolved == remapped_path.resolve()
    finally:
        settings.upload_dir = original_upload_dir


def test_legacy_upload_path_for_other_user_is_still_rejected(tmp_path):
    user_id = uuid4()
    other_user_id = uuid4()
    upload_root = tmp_path / "uploads"
    upload_root.mkdir(parents=True, exist_ok=True)

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        asset = Asset(
            user_id=user_id,
            filename="legacy.mp4",
            storage_path=f"/app/uploads/{other_user_id}/legacy.mp4",
            size_bytes=1024,
            asset_type="video",
        )

        with pytest.raises(HTTPException) as exc_info:
            resolve_asset_local_path(asset, user_id, must_exist=True)

        assert exc_info.value.status_code == 400
        assert (
            exc_info.value.detail
            == "Asset storage_path must be within the user's upload directory"
        )
    finally:
        settings.upload_dir = original_upload_dir


def test_object_storage_asset_uses_existing_local_cache(tmp_path):
    user_id = uuid4()
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    cache_path = user_dir / "cached.mp4"
    cache_path.write_text("video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        asset = Asset(
            user_id=user_id,
            filename="cached.mp4",
            storage_path=str(cache_path),
            storage_backend="object_storage",
            storage_key="assets/cached.mp4",
            size_bytes=cache_path.stat().st_size,
            asset_type="video",
        )

        resolved = resolve_asset_local_path(asset, user_id, must_exist=True)

        assert resolved == cache_path.resolve()
        assert get_asset_storage_key(asset) == "assets/cached.mp4"
    finally:
        settings.upload_dir = original_upload_dir


def test_object_storage_asset_without_local_cache_fails_closed(tmp_path):
    user_id = uuid4()
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    cache_path = user_dir / "uncached.mp4"

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        asset = Asset(
            user_id=user_id,
            filename="uncached.mp4",
            storage_path=str(cache_path),
            storage_backend="object_storage",
            storage_key="assets/uncached.mp4",
            size_bytes=1024,
            asset_type="video",
        )

        with pytest.raises(HTTPException) as exc_info:
            resolve_asset_local_path(asset, user_id, must_exist=True)

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["error"] == "asset_local_file_unavailable"
        assert exc_info.value.detail["storage_key"] == "assets/uncached.mp4"
    finally:
        settings.upload_dir = original_upload_dir
