"""Tests for media collection CRUD helpers to guard regressions in builder UI."""

import pytest
from uuid import uuid4
from sqlalchemy import select, text
from fastapi import HTTPException

from app.api.routes import media_collections as collections_api
from app.core.database import async_session_maker
from app.models.database import Asset, CollectionItem, MediaCollection, Stream, UserProfile
from app.schemas.api import CollectionItemCreate, CollectionItemsUpdate, MediaCollectionCreate


async def _require_table(session, table_name: str) -> None:
    result = await session.execute(
        text("SELECT to_regclass(:table_name)"),
        {"table_name": f"public.{table_name}"},
    )
    if not result.scalar():
        pytest.skip(f"{table_name} table not available in this test environment")


@pytest.mark.asyncio
async def test_create_media_collection_persists_items():
    user_id = uuid4()
    async with async_session_maker() as session:
        for table in ("media_collections", "collection_items", "assets"):
            await _require_table(session, table)

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@collections.test",
                subscription_tier="free",
                subscription_status="active",
            )
        )

        asset = Asset(
            user_id=user_id,
            filename="clip.mp4",
            storage_path=f"/tmp/{user_id}.mp4",
            size_bytes=1024,
            asset_type="video",
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)

        payload = MediaCollectionCreate(
            name="Highlights",
            collection_type="video_background",
            items=[CollectionItemCreate(asset_id=asset.id, position=0, loop_mode="loop")],
        )

        response = await collections_api.create_media_collection(payload, user_deps=(session, user_id))

        assert response.name == "Highlights"
        assert len(response.items) == 1
        assert response.items[0].asset_id == asset.id

        db_collection = (
            await session.execute(
                select(MediaCollection).where(MediaCollection.id == response.id)
            )
        ).scalar_one()
        assert db_collection.collection_type == "video_background"


@pytest.mark.asyncio
async def test_replace_media_collection_items_updates_payload():
    user_id = uuid4()
    async with async_session_maker() as session:
        for table in ("media_collections", "collection_items", "assets"):
            await _require_table(session, table)

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@collections.test",
                subscription_tier="free",
                subscription_status="active",
            )
        )

        first_asset = Asset(
            user_id=user_id,
            filename="clip-a.mp4",
            storage_path=f"/tmp/{user_id}-a.mp4",
            size_bytes=1024,
            asset_type="video",
        )
        second_asset = Asset(
            user_id=user_id,
            filename="clip-b.mp4",
            storage_path=f"/tmp/{user_id}-b.mp4",
            size_bytes=2048,
            asset_type="video",
        )
        session.add_all([first_asset, second_asset])
        await session.commit()
        await session.refresh(first_asset)
        await session.refresh(second_asset)

        collection = await collections_api.create_media_collection(
            MediaCollectionCreate(
                name="Initial",
                collection_type="video_background",
                items=[CollectionItemCreate(asset_id=first_asset.id, position=0, loop_mode="loop")],
            ),
            user_deps=(session, user_id),
        )

        response = await collections_api.replace_collection_items(
            collection.id,
            CollectionItemsUpdate(
                items=[
                    CollectionItemCreate(asset_id=second_asset.id, position=0, loop_mode="once"),
                    CollectionItemCreate(asset_id=first_asset.id, position=1, loop_mode="shuffle"),
                ]
            ),
            user_deps=(session, user_id),
        )

        assert [item.asset_id for item in response.items] == [second_asset.id, first_asset.id]
        assert response.items[0].position == 0
        assert response.items[0].loop_mode == "once"
        assert response.items[1].loop_mode == "shuffle"

        db_items = (
            await session.execute(
                select(CollectionItem)
                .where(CollectionItem.collection_id == collection.id)
                .order_by(CollectionItem.position)
            )
        ).scalars().all()
        assert [item.asset_id for item in db_items] == [second_asset.id, first_asset.id]
        assert [item.loop_mode for item in db_items] == ["once", "shuffle"]


@pytest.mark.asyncio
async def test_delete_media_collection_blocked_when_stream_uses_it():
    user_id = uuid4()
    async with async_session_maker() as session:
        for table in ("media_collections", "collection_items", "assets", "streams"):
            await _require_table(session, table)

        session.add(
            UserProfile(
                user_id=user_id,
                email=f"{user_id}@collections.test",
                subscription_tier="free",
                subscription_status="active",
            )
        )

        asset = Asset(
            user_id=user_id,
            filename="clip.mp4",
            storage_path=f"/tmp/{user_id}.mp4",
            size_bytes=1024,
            asset_type="video",
        )
        session.add(asset)
        await session.commit()
        await session.refresh(asset)

        collection = await collections_api.create_media_collection(
            MediaCollectionCreate(
                name="In use",
                collection_type="video_background",
                items=[CollectionItemCreate(asset_id=asset.id, position=0, loop_mode="loop")],
            ),
            user_deps=(session, user_id),
        )

        session.add(
            Stream(
                user_id=user_id,
                name="Test stream",
                status="stopped",
                video_collection_id=collection.id,
            )
        )
        await session.commit()

        with pytest.raises(HTTPException) as exc:
            await collections_api.delete_media_collection(collection.id, user_deps=(session, user_id))

        assert exc.value.status_code == 409
