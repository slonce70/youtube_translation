import pytest
from uuid import uuid4

from app.core.database import async_session_maker
from app.core.quota import QuotaEnforcer
from app.models.database import UserProfile


@pytest.mark.asyncio
async def test_audio_only_quality_passes():
    user_id = uuid4()
    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@audio-quality.test",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)
        await session.commit()

        enforcer = QuotaEnforcer(session, user_id)
        audio_assets = [
            {
                "asset_id": uuid4(),
                "filename": "ambient.m4a",
                "meta": {
                    "audio": {
                        "codec": "aac",
                        "sample_rate": 48_000,
                        "bitrate": 192_000,
                        "channels": 2,
                    },
                    "bitrate": 192_000,
                },
            }
        ]

        result = await enforcer.evaluate_stream_quality(
            [],
            audio_assets=audio_assets,
            mix_mode="audio_only",
        )

        assert result["ok"] is True
        assert result["mode"] == "audio"
        assert result["violations"] == []
        assert result["audio_recommended"] is not None


@pytest.mark.asyncio
async def test_audio_only_quality_accepts_mp3():
    user_id = uuid4()
    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@audio-quality.test",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)
        await session.commit()

        enforcer = QuotaEnforcer(session, user_id)
        audio_assets = [
            {
                "asset_id": uuid4(),
                "filename": "podcast.mp3",
                "meta": {
                    "audio": {
                        "codec": "mp3",
                        "sample_rate": 48_000,
                        "bitrate": 160_000,
                        "channels": 2,
                    },
                    "bitrate": 160_000,
                },
            }
        ]

        result = await enforcer.evaluate_stream_quality(
            [],
            audio_assets=audio_assets,
            mix_mode="audio_only",
        )

        assert result["ok"] is True
        assert result["violations"] == []


@pytest.mark.asyncio
async def test_audio_only_quality_detects_mismatched_codec():
    user_id = uuid4()
    async with async_session_maker() as session:
        profile = UserProfile(
            user_id=user_id,
            email=f"{user_id}@audio-quality.test",
            subscription_tier="free",
            subscription_status="active",
        )
        session.add(profile)
        await session.commit()

        enforcer = QuotaEnforcer(session, user_id)
        audio_assets = [
            {
                "asset_id": uuid4(),
                "filename": "podcast.opus",
                "meta": {
                    "audio": {
                        "codec": "opus",
                        "sample_rate": 32_000,
                        "bitrate": 96_000,
                        "channels": 2,
                    },
                    "bitrate": 96_000,
                },
            }
        ]

        result = await enforcer.evaluate_stream_quality(
            [],
            audio_assets=audio_assets,
            mix_mode="audio_only",
        )

        assert result["ok"] is False
        codes = {violation["code"] for violation in result["violations"]}
        assert "audio_codec_not_allowed" in codes
        assert "audio_sample_rate_low" in codes
