import type { Stream } from '../types'
import {
  countLiveProviders,
  getProviderStatusKey,
  getProviderBadgeVariant,
} from '../provider-status'

function makeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: 'stream-1',
    playlist_id: null,
    source_type: 'playlist',
    name: 'Stream',
    status: 'stopped',
    pid: null,
    log_path: null,
    error_message: null,
    started_at: null,
    stopped_at: null,
    video_collection_id: null,
    audio_collection_id: null,
    mix_mode: 'video_only',
    settings_json: {},
    total_duration_seconds: 0,
    created_at: '2026-04-06T00:00:00Z',
    updated_at: '2026-04-06T00:00:00Z',
    destinations: [],
    runtime_restart: {
      enabled: true,
      state: 'idle',
      attempts: 0,
      max_attempts: 5,
      next_restart_at: null,
      last_restart_at: null,
      last_failure_at: null,
    },
    ...overrides,
  }
}

describe('provider-status helpers', () => {
  it('counts only provider-live streams', () => {
    const streams = [
      makeStream({ id: 'a', provider_status: 'live' }),
      makeStream({ id: 'b', provider_status: 'offline' }),
      makeStream({ id: 'c', provider_status: 'stale' }),
    ]

    expect(countLiveProviders(streams)).toBe(1)
  })

  it('maps provider statuses to UI labels and variants', () => {
    expect(getProviderStatusKey('live')).toBe('live')
    expect(getProviderBadgeVariant('live')).toBe('live')
    expect(getProviderStatusKey('stale')).toBe('stale')
    expect(getProviderBadgeVariant('stale')).toBe('warn')
  })
})
