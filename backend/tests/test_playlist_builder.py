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


def test_validate_audio_playlist_assets_success():
    assets = [
        {
            "path": "/audio/track1.aac",
            "meta": {
                "audio": {
                    "codec": "aac",
                    "sample_rate": 44100,
                }
            },
        }
    ]

    valid, issues = PlaylistBuilder.validate_audio_playlist_assets(assets)

    assert valid is True
    assert issues == []


def test_validate_audio_playlist_assets_missing_metadata():
    assets = [
        {
            "path": "/audio/track1.aac",
            "meta": {},
        }
    ]

    valid, issues = PlaylistBuilder.validate_audio_playlist_assets(assets)

    assert valid is False
    assert any(issue["code"] == "missing_audio_metadata" for issue in issues)


def test_prepare_stream_playlists_creates_files(tmp_path):
    builder = PlaylistBuilder()

    video_source = tmp_path / "video.mp4"
    video_source.write_text("dummy")
    audio_source = tmp_path / "audio.aac"
    audio_source.write_text("dummy")

    result = builder.prepare_stream_playlists(
        stream_id="test-stream",
        stream_dir=tmp_path / "artifacts",
        video_assets=[
            {
                "path": str(video_source),
                "meta": sample_meta(),
                "loop_mode": "loop",
                "compatible_for_copy": True,
            }
        ],
        audio_assets=[
            {
                "path": str(audio_source),
                "meta": {"audio": {"codec": "aac", "sample_rate": 44100}},
                "loop_mode": "loop",
            }
        ],
        mix_mode="mixed",
    )

    assert result.video_playlist is not None
    assert result.video_playlist.exists()
    assert result.audio_playlist is not None
    assert result.audio_playlist.exists()
    assert result.mix_mode == "mixed"
    assert result.video_copy_compatible is True
    assert result.audio_copy_compatible is True


def test_prepare_stream_playlists_flags_mp3_for_transcode(tmp_path):
    builder = PlaylistBuilder()

    video_source = tmp_path / "video.mp4"
    video_source.write_text("dummy")
    audio_source = tmp_path / "audio.mp3"
    audio_source.write_text("dummy")

    result = builder.prepare_stream_playlists(
        stream_id="mp3-audio",
        stream_dir=tmp_path / "artifacts-mp3",
        video_assets=[
            {
                "path": str(video_source),
                "meta": sample_meta(),
                "loop_mode": "loop",
                "compatible_for_copy": True,
            }
        ],
        audio_assets=[
            {
                "path": str(audio_source),
                "meta": {"audio": {"codec": "mp3", "sample_rate": 44100}},
                "loop_mode": "loop",
            }
        ],
        mix_mode="mixed",
    )

    assert result.audio_playlist is not None
    assert result.audio_copy_compatible is False


def test_prepare_stream_playlists_mixed_uses_placeholder_when_video_missing(tmp_path):
    builder = PlaylistBuilder()

    audio_source = tmp_path / "audio.aac"
    audio_source.write_text("dummy")

    result = builder.prepare_stream_playlists(
        stream_id="mixed-placeholder",
        stream_dir=tmp_path / "artifacts-placeholder",
        video_assets=[],
        audio_assets=[
            {
                "path": str(audio_source),
                "meta": {"audio": {"codec": "aac", "sample_rate": 44100}},
                "loop_mode": "loop",
            }
        ],
        mix_mode="mixed",
    )

    assert result.video_playlist is None
    assert result.needs_video_placeholder is True
    assert result.audio_playlist is not None
