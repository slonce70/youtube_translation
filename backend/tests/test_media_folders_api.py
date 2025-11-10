"""Tests for media folder CRUD helpers and bulk asset operations."""

import pytest
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.routes import media_folders as folders_api
from app.core.database import async_session_maker
from app.models.database import Asset, AssetFolderLink, MediaFolder, UserProfile
from app.schemas.api import MediaFolderBulkAssetRequest, MediaFolderCreate, MediaFolderUpdate


async def _require_table(session, table_name: str) -> None:
    result = await session.execute(
        text("SELECT to_regclass(:table_name)"),
        {"table_name": f"public.{table_name}"},
    )
    if not result.scalar():
        pytest.skip(f"{table_name} table not available in this test environment")


@pytest.mark.asyncio
async def test_create_media_folder_bootstraps_root():
    user_id = uuid4()
    async with async_session_maker() as session:
        await _require_table(session, "media_folders")
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@folders.test",
                subscription_tier='free',
                subscription_status='active',
            )
        )
        await session.commit()

        folder = await folders_api.create_media_folder(
            MediaFolderCreate(name="Highlights"),
            user_deps=(session, user_id),
        )

        assert folder.name == "Highlights"
        assert folder.is_root is False
        assert folder.parent_id is not None

        roots = await session.execute(
            select(MediaFolder).where(
                MediaFolder.user_id == user_id,
                MediaFolder.is_root.is_(True),
            )
        )
        root = roots.scalar_one()
        assert folder.parent_id == root.id


@pytest.mark.asyncio
async def test_update_media_folder_disallows_cycles():
    user_id = uuid4()
    async with async_session_maker() as session:
        await _require_table(session, "media_folders")
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@cycle.test",
                subscription_tier='free',
                subscription_status='active',
            )
        )
        await session.commit()

        parent = await folders_api.create_media_folder(
            MediaFolderCreate(name="Parent"),
            user_deps=(session, user_id),
        )
        child = await folders_api.create_media_folder(
            MediaFolderCreate(name="Child", parent_id=parent.id),
            user_deps=(session, user_id),
        )
        grandchild = await folders_api.create_media_folder(
            MediaFolderCreate(name="Grandchild", parent_id=child.id),
            user_deps=(session, user_id),
        )

        with pytest.raises(HTTPException) as exc:
            await folders_api.update_media_folder(
                parent.id,
                MediaFolderUpdate(parent_id=grandchild.id),
                user_deps=(session, user_id),
            )
        assert exc.value.status_code == 400
        assert "descendant" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_bulk_move_assets_to_folder_respects_exclusive_flag():
    user_id = uuid4()
    async with async_session_maker() as session:
        await _require_table(session, "media_folders")
        await _require_table(session, "asset_folder_links")
        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@bulk.test",
                subscription_tier='free',
                subscription_status='active',
            )
        )
        await session.commit()

        folder_a = await folders_api.create_media_folder(
            MediaFolderCreate(name="Folder A"),
            user_deps=(session, user_id),
        )
        folder_b = await folders_api.create_media_folder(
            MediaFolderCreate(name="Folder B"),
            user_deps=(session, user_id),
        )

        asset = Asset(
            user_id=user_id,
            filename="clip.mp4",
            storage_path=f"/tmp/{user_id}.mp4",
            size_bytes=1024,
            asset_type='video',
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)

        await folders_api.add_asset_to_folder(folder_a.id, asset.id, user_deps=(session, user_id))

        response = await folders_api.bulk_move_assets_to_folder(
            folder_b.id,
            MediaFolderBulkAssetRequest(asset_ids=[asset.id], exclusive=True),
            user_deps=(session, user_id),
        )

        assert response.updated_assets == 1

        links = await session.execute(
            select(AssetFolderLink.folder_id).where(AssetFolderLink.asset_id == asset.id)
        )
        linked_ids = {row[0] for row in links}
        assert linked_ids == {folder_b.id}
