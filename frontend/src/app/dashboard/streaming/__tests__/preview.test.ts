import type { Stream } from '@/lib/types'

import {
  buildYouTubeEmbedUrl,
  getStreamPreviewState,
} from '../preview'

function makeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: 'stream-1',
    playlist_id: 'playlist-1',
    source_type: 'playlist',
    name: 'Preview stream',
    status: 'running',
    pid: 123,
    log_path: null,
    error_message: null,
    started_at: '2026-04-19T18:00:00Z',
    stopped_at: null,
    video_collection_id: null,
    audio_collection_id: null,
    mix_mode: 'video_only',
    settings_json: {},
    total_duration_seconds: 120,
    created_at: '2026-04-19T17:55:00Z',
    updated_at: '2026-04-19T18:01:00Z',
    stream_assets: [],
    destinations: [],
    provider_status: 'live',
    provider_video_id: 'abc123xyz',
    provider_viewers: null,
    provider_last_checked_at: null,
    provider_stream_status: null,
    provider_health_status: null,
    provider_health_issues: [],
    provider_mismatch: false,
    scheduled_start_enabled: false,
    scheduled_start_time: null,
    scheduled_stop_time: null,
    uptime_seconds: 30,
    runtime_restart: {
      enabled: false,
      state: 'disabled',
      attempts: 0,
      max_attempts: 0,
      next_restart_at: null,
      last_restart_at: null,
      last_failure_at: null,
    },
    ...overrides,
  }
}

describe('stream preview helpers', () => {
  it('builds a muted youtube embed url', () => {
    expect(buildYouTubeEmbedUrl('abc123xyz')).toBe(
      'https://www.youtube.com/embed/abc123xyz?autoplay=1&mute=1&playsinline=1&rel=0',
    )
  })

  it('marks a live stream with provider video id as ready', () => {
    expect(getStreamPreviewState(makeStream())).toEqual({
      kind: 'ready',
      videoId: 'abc123xyz',
    })
  })

  it('marks a running stream without provider video id as pending', () => {
    expect(
      getStreamPreviewState(
        makeStream({
          provider_video_id: null,
          provider_status: 'unknown',
        }),
      ),
    ).toEqual({
      kind: 'pending',
      videoId: null,
    })
  })

  it('marks a stopped stream without provider metadata as unavailable', () => {
    expect(
      getStreamPreviewState(
        makeStream({
          status: 'stopped',
          provider_status: 'offline',
          provider_video_id: null,
        }),
      ),
    ).toEqual({
      kind: 'unavailable',
      videoId: null,
    })
  })

  it('does not allow preview for a stopped stream with a lingering provider video id', () => {
    expect(
      getStreamPreviewState(
        makeStream({
          status: 'stopped',
          provider_status: 'live',
          provider_video_id: 'stale123',
        }),
      ),
    ).toEqual({
      kind: 'unavailable',
      videoId: null,
    })
  })
})
