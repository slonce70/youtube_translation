import pytest

from app.streaming.playlist_builder import PlaylistBuilder


def sample_meta(
    video_codec="h264",
    width=1920,
    height=1080,
    pix_fmt="yuv420p",
    fps=30,
    audio_codec="aac",
    sample_rate=48000,
):
    return {
        "video": {
            "codec": video_codec,
            "width": width,
            "height": height,
            "pix_fmt": pix_fmt,
            "fps": fps,
        },
        "audio": {
            "codec": audio_codec,
            "sample_rate": sample_rate,
        },
    }


def test_validate_playlist_assets_success():
    assets = [
        {"path": "/videos/one.mp4", "meta": sample_meta()},
        {"path": "/videos/two.mp4", "meta": sample_meta()},
    ]

    valid, issues = PlaylistBuilder.validate_playlist_assets(assets)

    assert valid is True
    assert issues == []


def test_validate_playlist_assets_missing_metadata():
    assets = [
        {"path": "/videos/one.mp4", "meta": sample_meta()},
        {"path": "/videos/two.mp4", "meta": None},
    ]

    valid, issues = PlaylistBuilder.validate_playlist_assets(assets)

    assert valid is False
    assert any(issue["code"] == "missing_metadata" for issue in issues)


def test_validate_playlist_assets_codec_mismatch():
    assets = [
        {"path": "/videos/one.mp4", "meta": sample_meta()},
        {"path": "/videos/two.mp4", "meta": sample_meta(video_codec="hevc")},
    ]

    valid, issues = PlaylistBuilder.validate_playlist_assets(assets)

    assert valid is False
    codes = {issue["code"] for issue in issues}
    assert "video_codec_mismatch" in codes
