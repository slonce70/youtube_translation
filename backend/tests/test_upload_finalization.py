from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.routes import assets as assets_routes
from app.core.config import settings
from app.core.database import async_session_maker
from app.models.database import Asset, UploadIngest, UserProfile
from app.schemas.api import UploadIngestResponse
from app.services.assets.service import UploadTokenService
from app.services.assets.upload_service import AssetUploadService
from app.services.assets import utils as asset_utils


class _ValidatorStub:
    async def validate_file(self, _file_path: Path):
        return {
            "compatible_for_copy": True,
            "meta": {"format_name": "mp4"},
            "validation_errors": [],
        }

    def get_stream_info(self, _meta):
        return {
            "duration": 42.0,
            "size_bytes": 0,
            "bitrate": 4_000_000,
            "warnings": [],
        }


def _build_payload(*, upload_id: str, token: str, file_path: Path, filename: str):
    return {
        "Type": "post-finish",
        "Upload": {
            "ID": upload_id,
            "MetaData": {
                "upload_token": token,
                "filename": filename,
                "asset_type": "video",
            },
            "Storage": {
                "Path": str(file_path),
            },
        },
        "Storage": {
            "Path": str(file_path),
        },
    }


async def _create_user(session, *, user_id):
    profile = UserProfile(
        user_id=user_id,
        email=f"{user_id}@example.com",
        subscription_tier="free",
        current_storage_bytes=0,
    )
    session.add(profile)
    await session.commit()
    return profile


@pytest.mark.asyncio
async def test_upload_complete_persists_ingest_and_asset(tmp_path, monkeypatch):
    user_id = uuid4()
    upload_id = f"upload-finalize-success-{uuid4()}"
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")
    file_size = temp_file.stat().st_size

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr("app.services.assets.upload_service.validator", _ValidatorStub())
    
    async def _thumbnail_success(**_kwargs):
        return "/thumbnails/upload-finalize-success.jpg"

    monkeypatch.setattr(
        "app.services.assets.upload_service.generate_video_thumbnail",
        _thumbnail_success,
    )

    try:
        async with async_session_maker() as session:
            await _create_user(session, user_id=user_id)
            token = UploadTokenService(user_id).create_token().token
            service = AssetUploadService(session)

            response = await service.handle_upload_complete(
                _build_payload(
                    upload_id=upload_id,
                    token=token,
                    file_path=temp_file,
                    filename="launch.mp4",
                )
            )

            assert response["success"] is True
            assert response["status"] == "finalized"
            assert response["filename"] == "launch.mp4"
            assert response["asset_type"] == "video"

            ingest = (
                (
                    await session.execute(
                        select(UploadIngest).where(UploadIngest.upload_id == upload_id)
                    )
                )
                .scalars()
                .one()
            )
            asset = await session.get(Asset, ingest.asset_id)
            user = await session.get(UserProfile, user_id)

            assert ingest.status == "finalized"
            assert ingest.asset_id is not None
            assert ingest.attempt_count == 1
            assert ingest.error_code is None
            assert ingest.local_path == str(upload_root / str(user_id) / upload_id)
            assert ingest.warning_messages == []
            assert asset is not None
            assert asset.storage_path == ingest.local_path
            assert asset.filename == "launch.mp4"
            assert user.current_storage_bytes == file_size
            assert (upload_root / str(user_id) / upload_id).exists()
            assert not temp_file.exists()
    finally:
        settings.upload_dir = original_upload_dir


@pytest.mark.asyncio
async def test_upload_complete_is_idempotent_by_upload_id(tmp_path, monkeypatch):
    user_id = uuid4()
    upload_id = f"upload-replay-safe-{uuid4()}"
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr("app.services.assets.upload_service.validator", _ValidatorStub())

    async def _thumbnail_skip(**_kwargs):
        return None

    monkeypatch.setattr(
        "app.services.assets.upload_service.generate_video_thumbnail",
        _thumbnail_skip,
    )

    try:
        async with async_session_maker() as session:
            await _create_user(session, user_id=user_id)
            token = UploadTokenService(user_id).create_token().token
            service = AssetUploadService(session)
            payload = _build_payload(
                upload_id=upload_id,
                token=token,
                file_path=temp_file,
                filename="loop.mp4",
            )

            first = await service.handle_upload_complete(payload)
            second = await service.handle_upload_complete(payload)

            assert first["success"] is True
            assert second["success"] is True
            assert first["asset_id"] == second["asset_id"]

            ingest_count = (
                await session.execute(
                    select(func.count())
                    .select_from(UploadIngest)
                    .where(UploadIngest.upload_id == upload_id)
                )
            ).scalar_one()
            asset_count = (
                await session.execute(
                    select(func.count())
                    .select_from(Asset)
                    .where(Asset.user_id == user_id)
                )
            ).scalar_one()
            user = await session.get(UserProfile, user_id)
            await session.refresh(user)

            assert ingest_count == 1
            assert asset_count == 1
            assert user.current_storage_bytes == len(b"fake-video")
    finally:
        settings.upload_dir = original_upload_dir


@pytest.mark.asyncio
async def test_upload_complete_marks_missing_file_as_failed_ingest(tmp_path, monkeypatch):
    user_id = uuid4()
    upload_id = f"upload-missing-file-{uuid4()}"
    upload_root = tmp_path / "uploads"
    upload_root.mkdir(parents=True, exist_ok=True)
    missing_file = upload_root / "_temp" / upload_id

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr("app.services.assets.upload_service.validator", _ValidatorStub())

    try:
        async with async_session_maker() as session:
            await _create_user(session, user_id=user_id)
            token = UploadTokenService(user_id).create_token().token
            service = AssetUploadService(session)

            response = await service.handle_upload_complete(
                _build_payload(
                    upload_id=upload_id,
                    token=token,
                    file_path=missing_file,
                    filename="ghost.mp4",
                )
            )

            assert response["success"] is False
            assert response["status"] == "failed"
            assert response["error_code"] == "upload_file_missing"

            ingest = (
                (
                    await session.execute(
                        select(UploadIngest).where(UploadIngest.upload_id == upload_id)
                    )
                )
                .scalars()
                .one()
            )
            asset_count = (
                await session.execute(
                    select(func.count())
                    .select_from(Asset)
                    .where(Asset.user_id == user_id)
                )
            ).scalar_one()
            user = await session.get(UserProfile, user_id)

            assert ingest.status == "failed"
            assert ingest.asset_id is None
            assert ingest.failed_at is not None
            assert asset_count == 0
            assert user.current_storage_bytes == 0
    finally:
        settings.upload_dir = original_upload_dir


def test_post_finish_redacts_upload_token_in_failure_manifest(tmp_path):
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    upload_id = f"upload-manifest-redaction-{uuid4()}"
    user_id = uuid4()
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")

    token, _ = asset_utils.generate_upload_token(user_id)
    payload = {
        "Upload": {
            "ID": upload_id,
            "MetaData": {
                "upload_token": token,
                "filename": "sensitive.mp4",
            },
            "Storage": {
                "Path": str(temp_file),
            },
        },
        "Storage": {
            "Path": str(temp_file),
        },
    }

    script_path = Path(__file__).resolve().parents[1] / "tusd-hooks" / "post-finish"
    env = {
        **os.environ,
        "TUSD_UPLOAD_ROOT": str(upload_root),
        "TUSD_BACKEND_URL": "http://127.0.0.1:1",
        "UPLOAD_TOKEN_SECRET": settings.upload_token_secret,
    }

    result = subprocess.run(
        [str(script_path)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )

    assert result.returncode == 0, result.stderr

    manifest_path = upload_root / "_failed-finalizations" / f"{upload_id}.json"
    assert manifest_path.exists(), result.stderr

    manifest = json.loads(manifest_path.read_text())
    payload_json = manifest["payload"]

    assert payload_json["Upload"]["MetaData"].get("upload_token") in (None, "[REDACTED]")
    assert token not in manifest_path.read_text()


@pytest.mark.asyncio
async def test_upload_status_api_is_owner_scoped(tmp_path, monkeypatch):
    owner_id = uuid4()
    stranger_id = uuid4()
    upload_id = f"upload-status-owner-scope-{uuid4()}"
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr("app.services.assets.upload_service.validator", _ValidatorStub())

    async def _thumbnail_skip(**_kwargs):
        return None

    monkeypatch.setattr(
        "app.services.assets.upload_service.generate_video_thumbnail",
        _thumbnail_skip,
    )

    try:
        async with async_session_maker() as session:
            await _create_user(session, user_id=owner_id)
            await _create_user(session, user_id=stranger_id)
            token = UploadTokenService(owner_id).create_token().token
            service = AssetUploadService(session)
            await service.handle_upload_complete(
                _build_payload(
                    upload_id=upload_id,
                    token=token,
                    file_path=temp_file,
                    filename="scope.mp4",
                )
            )

            ingest = await assets_routes.get_upload_status(
                upload_id=upload_id,
                user_deps=(session, owner_id),
            )
            assert ingest.upload_id == upload_id
            assert ingest.status == "finalized"

            with pytest.raises(HTTPException) as exc_info:
                await assets_routes.get_upload_status(
                    upload_id=upload_id,
                    user_deps=(session, stranger_id),
                )

            assert exc_info.value.status_code == 404
    finally:
        settings.upload_dir = original_upload_dir


@pytest.mark.asyncio
async def test_upload_status_response_normalizes_empty_message_lists(tmp_path, monkeypatch):
    user_id = uuid4()
    upload_id = f"upload-status-normalized-{uuid4()}"
    upload_root = tmp_path / "uploads"
    upload_root.mkdir(parents=True, exist_ok=True)
    missing_file = upload_root / "_temp" / upload_id

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr("app.services.assets.upload_service.validator", _ValidatorStub())

    try:
        async with async_session_maker() as session:
            await _create_user(session, user_id=user_id)
            token = UploadTokenService(user_id).create_token().token
            service = AssetUploadService(session)

            await service.handle_upload_complete(
                _build_payload(
                    upload_id=upload_id,
                    token=token,
                    file_path=missing_file,
                    filename="ghost.mp4",
                )
            )

            ingest = await service.get_upload_status(upload_id, user_id)
            response = UploadIngestResponse.model_validate(ingest)

            assert response.status == "failed"
            assert response.validation_errors == []
            assert response.warning_messages == []
    finally:
        settings.upload_dir = original_upload_dir


def test_upload_complete_status_code_tracks_failure_contract():
    assert (
        assets_routes._upload_complete_status_code({"success": True})
        == 200
    )
    assert (
        assets_routes._upload_complete_status_code(
            {"success": False, "error_code": "http_403"}
        )
        == 403
    )
    assert (
        assets_routes._upload_complete_status_code(
            {"success": False, "error_code": "upload_file_missing"}
        )
        == 404
    )
    assert (
        assets_routes._upload_complete_status_code(
            {"success": False, "error_code": "upload_finalize_failed"}
        )
        == 500
    )
