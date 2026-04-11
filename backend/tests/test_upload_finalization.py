from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.api.routes import assets as assets_routes
from app.core.config import settings
from app.core.database import _apply_schema_changes, async_session_maker, engine
from app.core.quota import QuotaExceededError
from app.models.database import Asset, AssetFolderLink, MediaFolder, UploadIngest, UserProfile
from app.schemas.api import AssetCreate, UploadIngestResponse
from app.services.assets.service import AssetService
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


def _build_payload(
    *,
    upload_id: str,
    token: str | None,
    file_path: Path,
    filename: str,
    storage_info_path: Path | None = None,
    folder_id: str | None = None,
):
    metadata = {
        "filename": filename,
        "asset_type": "video",
    }
    if folder_id is not None:
        metadata["folder_id"] = folder_id
    if token is not None:
        metadata["upload_token"] = token

    storage_payload = {
        "Path": str(file_path),
    }
    if storage_info_path is not None:
        storage_payload["InfoPath"] = str(storage_info_path)

    return {
        "Type": "post-finish",
        "Upload": {
            "ID": upload_id,
            "MetaData": metadata,
            "Storage": dict(storage_payload),
        },
        "Storage": dict(storage_payload),
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


async def _require_table(session, table_name: str) -> None:
    result = await session.execute(
        text("SELECT to_regclass(:table_name)"),
        {"table_name": f"public.{table_name}"},
    )
    if not result.scalar():
        pytest.skip(f"{table_name} table not available in this test environment")


def _build_expired_upload_token(user_id):
    expires_at = int(time.time()) - 5
    nonce = uuid4().hex
    payload = f"{user_id}:{expires_at}:{nonce}"
    signature = hmac.new(
        settings.upload_token_secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return base64.b64encode(f"{payload}:{signature}".encode("utf-8")).decode("utf-8")


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
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
    )

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
async def test_upload_complete_links_asset_to_requested_folder(tmp_path, monkeypatch):
    user_id = uuid4()
    upload_id = f"upload-folder-link-{uuid4()}"
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
    )

    async def _thumbnail_skip(**_kwargs):
        return None

    monkeypatch.setattr(
        "app.services.assets.upload_service.generate_video_thumbnail",
        _thumbnail_skip,
    )

    try:
        async with async_session_maker() as session:
            await _require_table(session, "media_folders")
            await _require_table(session, "asset_folder_links")
            await _create_user(session, user_id=user_id)

            root = MediaFolder(user_id=user_id, name="root", is_root=True)
            session.add(root)
            await session.flush()

            folder = MediaFolder(
                user_id=user_id,
                parent_id=root.id,
                name="Highlights",
                is_root=False,
            )
            session.add(folder)
            await session.commit()

            token = UploadTokenService(user_id).create_token().token
            service = AssetUploadService(session)

            response = await service.handle_upload_complete(
                _build_payload(
                    upload_id=upload_id,
                    token=token,
                    file_path=temp_file,
                    filename="foldered.mp4",
                    folder_id=str(folder.id),
                )
            )

            assert response["success"] is True

            ingest = (
                (
                    await session.execute(
                        select(UploadIngest).where(UploadIngest.upload_id == upload_id)
                    )
                )
                .scalars()
                .one()
            )

            links = await session.execute(
                select(AssetFolderLink.folder_id).where(
                    AssetFolderLink.asset_id == ingest.asset_id
                )
            )
            assert links.scalars().all() == [folder.id]
    finally:
        settings.upload_dir = original_upload_dir


@pytest.mark.asyncio
async def test_upload_complete_ignores_missing_folder_id(tmp_path, monkeypatch):
    user_id = uuid4()
    upload_id = f"upload-missing-folder-{uuid4()}"
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
    )

    async def _thumbnail_skip(**_kwargs):
        return None

    monkeypatch.setattr(
        "app.services.assets.upload_service.generate_video_thumbnail",
        _thumbnail_skip,
    )

    try:
        async with async_session_maker() as session:
            await _require_table(session, "media_folders")
            await _require_table(session, "asset_folder_links")
            await _create_user(session, user_id=user_id)
            token = UploadTokenService(user_id).create_token().token
            service = AssetUploadService(session)

            response = await service.handle_upload_complete(
                _build_payload(
                    upload_id=upload_id,
                    token=token,
                    file_path=temp_file,
                    filename="fallback.mp4",
                    folder_id=str(uuid4()),
                )
            )

            assert response["success"] is True

            ingest = (
                (
                    await session.execute(
                        select(UploadIngest).where(UploadIngest.upload_id == upload_id)
                    )
                )
                .scalars()
                .one()
            )

            links = await session.execute(
                select(AssetFolderLink.folder_id).where(
                    AssetFolderLink.asset_id == ingest.asset_id
                )
            )
            assert links.scalars().all() == []
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
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
    )

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
async def test_upload_complete_accepts_expired_token_after_upload_started(
    tmp_path, monkeypatch
):
    user_id = uuid4()
    upload_id = f"upload-expired-after-start-{uuid4()}"
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
    )

    async def _thumbnail_skip(**_kwargs):
        return None

    monkeypatch.setattr(
        "app.services.assets.upload_service.generate_video_thumbnail",
        _thumbnail_skip,
    )

    try:
        async with async_session_maker() as session:
            await _create_user(session, user_id=user_id)
            token = _build_expired_upload_token(user_id)
            service = AssetUploadService(session)

            response = await service.handle_upload_complete(
                _build_payload(
                    upload_id=upload_id,
                    token=token,
                    file_path=temp_file,
                    filename="late-finish.mp4",
                )
            )

            assert response["success"] is True
            assert response["status"] == "finalized"

            ingest = (
                (
                    await session.execute(
                        select(UploadIngest).where(UploadIngest.upload_id == upload_id)
                    )
                )
                .scalars()
                .one()
            )
            assert ingest.status == "finalized"
    finally:
        settings.upload_dir = original_upload_dir


@pytest.mark.asyncio
async def test_upload_complete_marks_missing_file_as_failed_ingest(
    tmp_path, monkeypatch
):
    user_id = uuid4()
    upload_id = f"upload-missing-file-{uuid4()}"
    upload_root = tmp_path / "uploads"
    upload_root.mkdir(parents=True, exist_ok=True)
    missing_file = upload_root / "_temp" / upload_id

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
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


@pytest.mark.asyncio
async def test_upload_complete_rejects_reused_upload_id_from_other_user(
    tmp_path, monkeypatch
):
    owner_id = uuid4()
    other_user_id = uuid4()
    upload_id = f"upload-owner-conflict-{uuid4()}"
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
    )

    async def _thumbnail_skip(**_kwargs):
        return None

    monkeypatch.setattr(
        "app.services.assets.upload_service.generate_video_thumbnail",
        _thumbnail_skip,
    )

    try:
        async with async_session_maker() as session:
            await _create_user(session, user_id=owner_id)
            await _create_user(session, user_id=other_user_id)
            owner_token = UploadTokenService(owner_id).create_token().token
            other_token = UploadTokenService(other_user_id).create_token().token
            service = AssetUploadService(session)

            first = await service.handle_upload_complete(
                _build_payload(
                    upload_id=upload_id,
                    token=owner_token,
                    file_path=temp_file,
                    filename="owner.mp4",
                )
            )
            assert first["success"] is True

            with pytest.raises(HTTPException) as exc_info:
                await service.handle_upload_complete(
                    _build_payload(
                        upload_id=upload_id,
                        token=other_token,
                        file_path=upload_root / "_temp" / f"{upload_id}-other",
                        filename="other.mp4",
                    )
                )

            assert exc_info.value.status_code == 409
            assert exc_info.value.detail["error"] == "upload_id_conflict"
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

    assert payload_json["Upload"]["MetaData"].get("upload_token") in (
        None,
        "[REDACTED]",
    )
    assert token not in manifest_path.read_text()


def test_post_finish_recovers_missing_token_from_info_file(tmp_path):
    upload_root = tmp_path / "uploads"
    upload_root.mkdir(parents=True, exist_ok=True)

    upload_id = f"upload-metadata-fallback-{uuid4()}"
    user_id = uuid4()
    temp_file = upload_root / upload_id
    temp_file.write_bytes(b"fake-video")

    token, _ = asset_utils.generate_upload_token(user_id)
    info_payload = {
        "ID": upload_id,
        "MetaData": {
            "upload_token": token,
            "user_id": str(user_id),
            "filename": "fallback.mp4",
        },
        "Storage": {
            "Path": str(temp_file),
        },
    }
    (upload_root / f"{upload_id}.info").write_text(json.dumps(info_payload))

    payload = {
        "Upload": {
            "ID": upload_id,
            "MetaData": {
                "user_id": str(user_id),
                "filename": "fallback.mp4",
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
    assert "Recovered upload token from info file" in result.stderr
    assert (upload_root / str(user_id) / upload_id).exists()

    manifest_path = upload_root / "_failed-finalizations" / f"{upload_id}.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        assert manifest["reason"] != "invalid_upload_token"
        assert manifest["reason"] != "missing_upload_token"


def test_post_finish_accepts_expired_token_after_upload_started(tmp_path):
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    upload_id = f"upload-expired-token-{uuid4()}"
    user_id = uuid4()
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")

    token = _build_expired_upload_token(user_id)
    payload = {
        "Upload": {
            "ID": upload_id,
            "MetaData": {
                "upload_token": token,
                "user_id": str(user_id),
                "filename": "expired.mp4",
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
    assert "Upload token expired" not in result.stderr
    assert (upload_root / str(user_id) / upload_id).exists()


def test_post_finish_recovers_from_invalid_hook_token_using_info_file(tmp_path):
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    upload_id = f"upload-invalid-hook-token-{uuid4()}"
    user_id = uuid4()
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")

    valid_token, _ = asset_utils.generate_upload_token(user_id)
    invalid_token = "not-a-valid-token"
    info_path = Path(f"{temp_file}.info")
    info_path.write_text(
        json.dumps(
            {
                "ID": upload_id,
                "MetaData": {
                    "upload_token": valid_token,
                    "user_id": str(user_id),
                    "filename": "recovered.mp4",
                },
                "Storage": {
                    "Path": str(temp_file),
                },
            }
        ),
        encoding="utf-8",
    )

    payload = {
        "Upload": {
            "ID": upload_id,
            "MetaData": {
                "upload_token": invalid_token,
                "user_id": str(user_id),
                "filename": "recovered.mp4",
            },
            "Storage": {
                "Path": str(temp_file),
                "InfoPath": str(info_path),
            },
        },
        "Storage": {
            "Path": str(temp_file),
            "InfoPath": str(info_path),
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
    assert "Retrying token resolution from info file" in result.stderr
    assert (upload_root / str(user_id) / upload_id).exists()

    manifest_path = upload_root / "_failed-finalizations" / f"{upload_id}.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        assert manifest["reason"] != "invalid_upload_token"


def test_post_finish_recovers_missing_token_from_user_dir_info_file(tmp_path):
    upload_root = tmp_path / "uploads"
    user_id = uuid4()
    upload_id = f"upload-user-dir-info-{uuid4()}"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    final_file = user_dir / upload_id
    final_file.write_bytes(b"fake-video")

    valid_token, _ = asset_utils.generate_upload_token(user_id)
    final_info = user_dir / f"{upload_id}.info"
    final_info.write_text(
        json.dumps(
            {
                "ID": upload_id,
                "MetaData": {
                    "upload_token": valid_token,
                    "user_id": str(user_id),
                    "filename": "recovered-from-user-dir.mp4",
                },
                "Storage": {
                    "Path": str(final_file),
                    "InfoPath": str(final_info),
                },
            }
        ),
        encoding="utf-8",
    )

    payload = {
        "Upload": {
            "ID": upload_id,
            "MetaData": {
                "user_id": str(user_id),
                "filename": "recovered-from-user-dir.mp4",
            },
            "Storage": {
                "Path": str(upload_root / upload_id),
                "InfoPath": str(upload_root / f"{upload_id}.info"),
            },
        },
        "Storage": {
            "InfoPath": str(upload_root / f"{upload_id}.info"),
        },
    }

    script_path = Path(__file__).resolve().parents[1] / "tusd-hooks" / "post-finish"
    env = {
        **os.environ,
        "TUSD_UPLOAD_ROOT": str(upload_root),
        "TUSD_BACKEND_URL": "http://127.0.0.1:1",
        "UPLOAD_TOKEN_SECRET": settings.upload_token_secret,
        "TUSD_HMAC_SECRET": "test-secret",
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
    assert "Recovered upload token from info file" in result.stderr
    assert "File already in user directory" in result.stderr
    assert str(final_file) in result.stderr

    manifest_path = upload_root / "_failed-finalizations" / f"{upload_id}.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["reason"] == "backend_unreachable"
    assert manifest["payload"]["Storage"]["Path"] == str(final_file)
    assert manifest["payload"]["Storage"]["InfoPath"] == str(final_info)


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
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
    )

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
async def test_upload_status_response_normalizes_empty_message_lists(
    tmp_path, monkeypatch
):
    user_id = uuid4()
    upload_id = f"upload-status-normalized-{uuid4()}"
    upload_root = tmp_path / "uploads"
    upload_root.mkdir(parents=True, exist_ok=True)
    missing_file = upload_root / "_temp" / upload_id

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
    )

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


@pytest.mark.asyncio
async def test_upload_status_uses_failed_manifest_when_ingest_missing(tmp_path):
    user_id = uuid4()
    upload_id = f"upload-failed-manifest-{uuid4()}"
    upload_root = tmp_path / "uploads"
    failure_dir = upload_root / "_failed-finalizations"
    failure_dir.mkdir(parents=True, exist_ok=True)

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    created_at = datetime.now(timezone.utc).replace(microsecond=0)
    manifest = {
        "upload_id": upload_id,
        "reason": "invalid_upload_token",
        "details": "Upload token could not be resolved",
        "created_at": created_at.isoformat().replace("+00:00", "Z"),
        "payload": {
            "Upload": {
                "ID": upload_id,
                "MetaData": {
                    "user_id": str(user_id),
                    "filename": "late.mp4",
                },
            },
            "Storage": {
                "Path": str(upload_root / str(user_id) / upload_id),
            },
        },
    }
    (failure_dir / f"{upload_id}.json").write_text(json.dumps(manifest))

    try:
        async with async_session_maker() as session:
            ingest = await AssetUploadService(session).get_upload_status(
                upload_id, user_id
            )

            assert ingest.status == "failed"
            assert ingest.error_code == "invalid_upload_token"
            assert ingest.error_message == "Upload token could not be resolved"
            assert ingest.filename == "late.mp4"
            assert ingest.failed_at == created_at
    finally:
        settings.upload_dir = original_upload_dir


def test_upload_complete_status_code_tracks_failure_contract():
    assert assets_routes._upload_complete_status_code({"success": True}) == 200
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
    assert (
        assets_routes._upload_complete_status_code(
            {
                "success": False,
                "error_code": "quota_exceeded",
                "http_status": 402,
            }
        )
        == 402
    )


@pytest.mark.asyncio
async def test_upload_complete_preserves_http_status_for_quota_errors(
    tmp_path, monkeypatch
):
    user_id = uuid4()
    upload_id = f"upload-quota-error-{uuid4()}"
    upload_root = tmp_path / "uploads"
    temp_dir = upload_root / "_temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_file = temp_dir / upload_id
    temp_file.write_bytes(b"fake-video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
    )

    async def _raise_quota(*_args, **_kwargs):
        raise QuotaExceededError(
            resource="assets",
            current=20,
            limit=20,
            tier="free",
        )

    monkeypatch.setattr(
        "app.core.quota.QuotaEnforcer.check_assets_limit",
        _raise_quota,
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
                    filename="quota.mp4",
                )
            )

            assert response["success"] is False
            assert response["error_code"] == "quota_exceeded"
            assert response["http_status"] == 402
            assert assets_routes._upload_complete_status_code(response) == 402
    finally:
        settings.upload_dir = original_upload_dir


@pytest.mark.asyncio
async def test_upload_complete_remaps_moved_legacy_user_path_into_current_upload_root(
    tmp_path, monkeypatch
):
    user_id = uuid4()
    upload_id = f"upload-moved-legacy-path-{uuid4()}"
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    final_file = user_dir / upload_id
    final_file.write_bytes(b"fake-video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)
    monkeypatch.setattr(
        "app.services.assets.upload_service.validator", _ValidatorStub()
    )

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

            response = await service.handle_upload_complete(
                _build_payload(
                    upload_id=upload_id,
                    token=token,
                    file_path=Path(f"/app/uploads/{user_id}/{upload_id}"),
                    filename="moved.mp4",
                )
            )

            assert response["success"] is True
            assert response["status"] == "finalized"

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

            assert ingest.status == "finalized"
            assert ingest.local_path == str(final_file)
            assert asset is not None
            assert asset.storage_path == str(final_file)
    finally:
        settings.upload_dir = original_upload_dir


@pytest.mark.asyncio
async def test_schema_changes_do_not_enable_duplicate_storage_accounting(tmp_path):
    user_id = uuid4()
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    asset_path = user_dir / "count-once.mp4"
    asset_path.write_bytes(b"video")

    original_upload_dir = settings.upload_dir
    settings.upload_dir = str(upload_root)

    try:
        async with engine.begin() as conn:
            await _apply_schema_changes(conn)

        async with async_session_maker() as session:
            await _create_user(session, user_id=user_id)
            service = AssetService(session, user_id)

            created = await service.create_asset(
                AssetCreate(
                    filename="count-once.mp4",
                    storage_path=str(asset_path),
                    size_bytes=len(b"video"),
                    asset_type="video",
                )
            )

            profile = await session.get(UserProfile, user_id)
            assert created.size_bytes == len(b"video")
            assert profile.current_storage_bytes == len(b"video")
    finally:
        settings.upload_dir = original_upload_dir
