import pytest

import pytest

from app.streaming.playlist_builder import (
    PlaylistBuilder,
    PlaylistOptions,
)


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


@pytest.mark.asyncio
async def test_build_media_playlists_creates_dual_files(tmp_path, monkeypatch):
    streams_dir = tmp_path / "streams"
    builder = PlaylistBuilder(streams_dir=streams_dir)

    video_file = tmp_path / "video.mp4"
    audio_file = tmp_path / "audio.aac"
    video_file.write_bytes(b"video")
    audio_file.write_bytes(b"audio")

    result = await builder.build_media_playlists(
        "stream1",
        video_assets=[{"file_path": str(video_file), "compatible_for_copy": True}],
        audio_assets=[{"file_path": str(audio_file), "compatible_for_copy": True}],
        video_options=PlaylistOptions(loop=False),
        audio_options=PlaylistOptions(loop=False),
    )

    assert result.video_playlist is not None
    assert result.audio_playlist is not None
    assert result.video_copy_compatible is True
    assert result.audio_copy_compatible is True
    assert result.video_playlist.exists()
    assert result.audio_playlist.exists()


@pytest.mark.asyncio
async def test_build_media_playlists_uses_placeholders(tmp_path, monkeypatch):
    placeholder_video = tmp_path / "placeholder.mp4"
    placeholder_audio = tmp_path / "placeholder.aac"
    placeholder_video.write_bytes(b"video")
    placeholder_audio.write_bytes(b"audio")

    monkeypatch.setattr("app.streaming.playlist_builder.settings.placeholder_video_path", str(placeholder_video))
    monkeypatch.setattr("app.streaming.playlist_builder.settings.placeholder_audio_path", str(placeholder_audio))

    streams_dir = tmp_path / "streams"
    builder = PlaylistBuilder(streams_dir=streams_dir)

    audio_real = tmp_path / "real.aac"
    audio_real.write_bytes(b"audio")

    result = await builder.build_media_playlists(
        "audio_only",
        video_assets=[],
        audio_assets=[{"file_path": str(audio_real)}],
    )

    assert result.used_video_placeholder is True
    assert result.video_playlist is not None
    assert result.audio_playlist is not None


@pytest.mark.asyncio
async def test_build_media_playlists_applies_shuffle(tmp_path):
    builder = PlaylistBuilder(streams_dir=tmp_path / "streams")

    video_files = []
    for idx in range(3):
        file_path = tmp_path / f"video_{idx}.mp4"
        file_path.write_bytes(b"data")
        video_files.append({"file_path": str(file_path), "compatible_for_copy": True, "asset_id": f"v{idx}"})

    options = PlaylistOptions(shuffle=True, shuffle_seed=42)
    result = await builder.build_media_playlists(
        "shuffle_test",
        video_assets=video_files,
        audio_assets=[],
        video_options=options,
    )

    ordered_ids = [item.get("asset_id") for item in result.video_items]
    assert ordered_ids != ["v0", "v1", "v2"]
