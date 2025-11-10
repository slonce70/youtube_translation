import pytest
from uuid import uuid4

from sqlalchemy import select, text

from app.api.routes.assets import delete_asset
from app.core.database import async_session_maker
from app.models.database import (
    Asset,
    UserProfile,
    MediaCollection,
    CollectionItem,
    SystemAlert,
)


@pytest.mark.asyncio
async def test_delete_asset_marks_collection_inactive_when_empty():
    user_id = uuid4()
    asset_id = uuid4()
    async with async_session_maker() as session:
        check = await session.execute(text("SELECT to_regclass('public.media_collections')"))
        if not check.scalar():
            pytest.skip("media_collections table not available in this test DB")
        profile = UserProfile(
            user_id=user_id,
            email=f"{uuid4()}@example.com",
            subscription_tier="free",
            current_storage_bytes=0,
        )
        session.add(profile)

        collection = MediaCollection(
            user_id=user_id,
            name="BG",
            collection_type="video_background",
        )
        session.add(collection)
        await session.flush()

        asset = Asset(
            id=asset_id,
            user_id=user_id,
            filename="clip.mp4",
            storage_path=f"/tmp/{asset_id}.mp4",
            size_bytes=500,
            asset_type="video",
        )
        session.add(asset)
        await session.flush()

        session.add(
            CollectionItem(
                collection_id=collection.id,
                asset_id=asset.id,
                position=0,
            )
        )
        await session.commit()

        await delete_asset(asset.id, user_deps=(session, user_id), force=True)

        updated_collection = await session.get(MediaCollection, collection.id)
        assert updated_collection.is_active is False

        alerts = (await session.execute(select(SystemAlert))).scalars().all()
        assert any(alert.alert_type == "collection_depleted" for alert in alerts)
