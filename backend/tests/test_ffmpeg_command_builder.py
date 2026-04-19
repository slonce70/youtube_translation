from types import SimpleNamespace

from app.streaming.command_builder import (
    build_destination_output_args,
    build_tee_destination,
    normalize_destinations,
)


def _settings(**overrides):
    base = {
        "ffmpeg_output_tcp_keepalive": True,
        "ffmpeg_output_rw_timeout_us": 15_000_000,
        "ffmpeg_output_recovery_max_attempts": 9,
        "ffmpeg_output_fifo_queue_size": 240,
        "ffmpeg_output_drop_pkts_on_overflow": True,
        "ffmpeg_tee_onfail_policy": "ignore",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_normalize_destinations_combines_url_and_key():
    normalized = normalize_destinations(
        [
            {"url": "rtmp://example.com/live/", "key": "stream"},
            {"url": "", "key": "only-key"},
        ]
    )

    assert normalized == [
        {"uri": "rtmp://example.com/live/stream"},
        {"uri": "only-key"},
    ]


def test_apply_output_transport_options_for_rtmp_and_rtmps():
    from app.streaming.command_builder import apply_output_transport_options

    assert (
        apply_output_transport_options(
            "rtmp://example.com/live/stream", settings_module=_settings()
        )
        == "rtmp://example.com/live/stream?tcp_keepalive=1&rw_timeout=15000000"
    )
    assert (
        apply_output_transport_options(
            "rtmps://example.com/live/stream?existing=1", settings_module=_settings()
        )
        == "rtmps://example.com/live/stream?existing=1&tcp_keepalive=1&rw_timeout=15000000"
    )
    assert (
        apply_output_transport_options("https://example.com/live/stream", settings_module=_settings())
        == "https://example.com/live/stream"
    )


def test_apply_output_transport_options_preserves_existing_transport_params():
    from app.streaming.command_builder import apply_output_transport_options

    assert (
        apply_output_transport_options(
            "rtmp://example.com/live/stream?tcp_keepalive=9&rw_timeout=7&existing=1",
            settings_module=_settings(),
        )
        == "rtmp://example.com/live/stream?tcp_keepalive=9&rw_timeout=7&existing=1"
    )


def test_build_tee_destination_renders_fifo_prefix():
    assert (
        build_tee_destination(
            "rtmp://example.com/live/stream", settings_module=_settings()
        )
        == "[select='v\\:0,a\\:0':onfail=ignore:f=fifo:fifo_format=flv:"
        "attempt_recovery=1:recovery_wait_time=5:recover_any_error=1:"
        "restart_with_keyframe=1:drop_pkts_on_overflow=1:queue_size=240:"
        "max_recovery_attempts=9]rtmp://example.com/live/stream?tcp_keepalive=1&rw_timeout=15000000"
    )


def test_build_destination_output_args_for_single_destination():
    result = build_destination_output_args(
        normalize_destinations(
            [{"url": "rtmp://example.com/live", "key": "stream"}]
        ),
        settings_module=_settings(),
    )

    assert result.command == [
        "-f",
        "fifo",
        "-fifo_format",
        "flv",
        "-attempt_recovery",
        "1",
        "-recovery_wait_time",
        "5",
        "-recover_any_error",
        "1",
        "-restart_with_keyframe",
        "1",
        "-drop_pkts_on_overflow",
        "1",
        "-queue_size",
        "240",
        "-max_recovery_attempts",
        "9",
        "rtmp://example.com/live/stream?tcp_keepalive=1&rw_timeout=15000000",
    ]
    assert result.destination_uris == [
        "rtmp://example.com/live/stream?tcp_keepalive=1&rw_timeout=15000000"
    ]
    assert result.multi_destination is False
    assert result.tee_onfail_policy is None


def test_build_destination_output_args_requires_at_least_one_destination():
    try:
        build_destination_output_args([], settings_module=_settings())
    except ValueError as exc:
        assert str(exc) == "At least one destination is required"
    else:
        raise AssertionError("Expected ValueError for empty destinations")


def test_build_destination_output_args_for_multi_destination():
    result = build_destination_output_args(
        normalize_destinations(
            [
                {"url": "rtmp://a.example.com/live", "key": "one"},
                {"url": "rtmp://b.example.com/live", "key": "two"},
            ]
        ),
        settings_module=_settings(),
    )

    assert result.command == [
        "-f",
        "tee",
        "|".join(
            [
                "[select='v\\:0,a\\:0':onfail=ignore:f=fifo:fifo_format=flv:"
                "attempt_recovery=1:recovery_wait_time=5:recover_any_error=1:"
                "restart_with_keyframe=1:drop_pkts_on_overflow=1:queue_size=240:"
                "max_recovery_attempts=9]rtmp://a.example.com/live/one?tcp_keepalive=1&rw_timeout=15000000",
                "[select='v\\:0,a\\:0':onfail=ignore:f=fifo:fifo_format=flv:"
                "attempt_recovery=1:recovery_wait_time=5:recover_any_error=1:"
                "restart_with_keyframe=1:drop_pkts_on_overflow=1:queue_size=240:"
                "max_recovery_attempts=9]rtmp://b.example.com/live/two?tcp_keepalive=1&rw_timeout=15000000",
            ]
        ),
    ]
    assert result.destination_uris == [
        "rtmp://a.example.com/live/one?tcp_keepalive=1&rw_timeout=15000000",
        "rtmp://b.example.com/live/two?tcp_keepalive=1&rw_timeout=15000000",
    ]
    assert result.multi_destination is True
    assert result.tee_onfail_policy == "ignore"
