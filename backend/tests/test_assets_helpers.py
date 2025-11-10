import pytest

from app.api.routes.assets import infer_asset_type, normalize_asset_type
from app.schemas.api import AssetCreate


def test_infer_asset_type_prefers_video_metadata():
    meta = {
        "video": {"codec": "h264"},
        "audio": {"codec": "aac"},
    }
    assert infer_asset_type(meta, "audio") == "video"


def test_infer_asset_type_audio_fallback():
    meta = {"audio": {"codec": "aac"}}
    assert infer_asset_type(meta, "video") == "audio"


def test_normalize_asset_type_rejects_invalid_values():
    meta = {"audio": {"codec": "aac"}}
    assert normalize_asset_type("invalid", meta) == "audio"


def test_asset_create_disallows_unknown_asset_type():
    with pytest.raises(ValueError):
        AssetCreate(
            filename="clip.wav",
            storage_path="/tmp/clip.wav",
            size_bytes=1024,
            asset_type="document",
        )


def test_asset_create_accepts_audio_type():
    asset = AssetCreate(
        filename="clip.wav",
        storage_path="/tmp/clip.wav",
        size_bytes=1024,
        asset_type="audio",
    )
    assert asset.asset_type == "audio"
