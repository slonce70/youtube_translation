import type { Stream, StreamRuntimeRestartInfo, StreamStatusResponse } from '../types'
import {
  deriveDashboardNextAction,
  deriveStreamState,
  summarizeRuntimeIncidentState,
  summarizeStreamLogIncidents,
  type StreamStatusQuery,
} from '../stream-state'

function createRestartInfo(overrides: Partial<StreamRuntimeRestartInfo> = {}): StreamRuntimeRestartInfo {
  return {
    enabled: true,
    state: 'idle',
    attempts: 0,
    max_attempts: 5,
    next_restart_at: null,
    last_restart_at: null,
    last_failure_at: null,
    ...overrides,
  }
}

function createStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: 'stream-1',
    playlist_id: 'playlist-1',
    source_type: 'playlist',
    name: 'My stream',
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
    created_at: '2026-03-30T08:00:00Z',
    updated_at: '2026-03-30T08:00:00Z',
    stream_assets: [],
    destinations: [],
    scheduled_start_enabled: false,
    scheduled_start_time: null,
    scheduled_stop_time: null,
    uptime_seconds: 0,
    runtime_restart: createRestartInfo(),
    ...overrides,
  }
}

describe('deriveStreamState', () => {
  it('prefers live status over stale list status', () => {
    const stream = createStream({ status: 'stopped' })
    const data: StreamStatusResponse = {
      id: stream.id,
      status: 'running',
      is_running: true,
      live_duration_seconds: 30,
      total_duration_seconds: 30,
      runtime_restart: createRestartInfo(),
    }

    const result = deriveStreamState(
      stream,
      { data, dataUpdatedAt: Date.now(), isError: false, isFetching: false },
      Date.now(),
    )

    expect(result.isRunning).toBe(true)
    expect(result.group).toBe('live')
    expect(result.primaryAction).toBe('stop')
  })

  it('routes errored streams into attention', () => {
    const stream = createStream({
      status: 'error',
      error_message: 'boom',
      runtime_restart: createRestartInfo({ state: 'scheduled', attempts: 1 }),
    })

    const result = deriveStreamState(stream)

    expect(result.requiresAttention).toBe(true)
    expect(result.group).toBe('attention')
    expect(result.primaryAction).toBe('view_issue')
  })

  it('treats provider health degradation as attention-worthy', () => {
    const stream = createStream({
      status: 'running',
      provider_health_status: 'ok',
      provider_health_issues: ['gopSizeOver'],
    })

    const result = deriveStreamState(stream)

    expect(result.requiresAttention).toBe(true)
    expect(result.group).toBe('live')
    expect(result.isDegraded).toBe(true)
    expect(result.incidentSummary.severity).toBe('degraded')
    expect(result.incidentSummary.headline).toBe('Провайдер повідомляє про деградацію потоку')
  })

  it('surfaces backend-provided runtime incident summaries for degraded running streams', () => {
    const stream = createStream({ status: 'running' })
    const data: StreamStatusResponse = {
      id: stream.id,
      status: 'running',
      is_running: true,
      live_duration_seconds: 30,
      total_duration_seconds: 30,
      runtime_restart: createRestartInfo(),
      runtime_incident_summary: {
        severity: 'degraded',
        headline: 'Runtime зафіксував повторні remote output resets',
        details: ['3 подій за останні 180с.'],
        items: [
          {
            code: 'transport_connection_reset',
            severity: 'degraded',
            label: 'Runtime зафіксував повторні remote output resets',
            detail: '3 подій за останні 180с.',
            count: 3,
          },
        ],
      },
    }

    const result = deriveStreamState(
      stream,
      { data, dataUpdatedAt: Date.now(), isError: false, isFetching: false },
      Date.now(),
    )

    expect(result.isRunning).toBe(true)
    expect(result.isDegraded).toBe(true)
    expect(result.requiresAttention).toBe(true)
    expect(result.incidentSummary.headline).toBe('Runtime зафіксував повторні remote output resets')
  })



  it('routes starting streams into transitioning with pending primary action', () => {
    const stream = createStream({ status: 'starting' })

    const result = deriveStreamState(stream)

    expect(result.isStarting).toBe(true)
    expect(result.isTransitioning).toBe(true)
    expect(result.group).toBe('transitioning')
    expect(result.primaryAction).toBe('pending')
  })

  it('routes stopping streams into transitioning with pending primary action', () => {
    const stream = createStream({ status: 'stopping' })

    const result = deriveStreamState(stream)

    expect(result.isStopping).toBe(true)
    expect(result.isTransitioning).toBe(true)
    expect(result.group).toBe('transitioning')
    expect(result.primaryAction).toBe('pending')
  })

  it('uses edit schedule as primary action for scheduled streams', () => {
    const stream = createStream({
      status: 'scheduled',
      scheduled_start_enabled: true,
      scheduled_start_time: '2026-04-04T08:00:00Z',
    })

    const result = deriveStreamState(stream)

    expect(result.group).toBe('scheduled')
    expect(result.primaryAction).toBe('edit_schedule')
  })

  it('keeps scheduled streams in the scheduled group even with stale incident context', () => {
    const stream = createStream({
      status: 'scheduled',
      scheduled_start_enabled: true,
      scheduled_start_time: '2026-04-04T08:00:00Z',
      runtime_incident_summary: {
        severity: 'degraded',
        headline: 'Historical warning',
        details: ['Previous run emitted runtime warnings'],
        items: [
          {
            code: 'timeline_drift',
            severity: 'degraded',
            label: 'Historical warning',
            detail: 'Previous run emitted runtime warnings',
          },
        ],
      },
    })

    const result = deriveStreamState(stream)

    expect(result.group).toBe('scheduled')
    expect(result.requiresAttention).toBe(true)
    expect(result.primaryAction).toBe('edit_schedule')
  })
})

describe('incident summaries', () => {
  it('marks stopped errored streams as critical without degraded-running state', () => {
    const summary = summarizeRuntimeIncidentState({
      isRunning: false,
      derivedStatus: 'error',
      quotaReached: false,
      runtimeRestart: createRestartInfo(),
      providerHealthAttention: false,
      providerHealthIssues: [],
      effectiveErrorMessage: 'ffmpeg exited with code 1',
    })

    expect(summary.severity).toBe('critical')
    expect(summary.headline).toBe('Трансляція завершилась з помилкою')
    expect(summary.details).toContain('ffmpeg exited with code 1')
  })

  it('summarizes transport faults with recovery as degraded log incident context', () => {
    const summary = summarizeStreamLogIncidents([
      '2026-04-11T10:00:00Z Connection reset by peer',
      '2026-04-11T10:00:01Z Broken pipe',
      '2026-04-11T10:00:02Z Recovery successful',
    ], {
      nowMs: Date.parse('2026-04-11T10:05:00Z'),
    })

    expect(summary.severity).toBe('degraded')
    expect(summary.headline).toBe("RTMPS ingest скинув з'єднання 1 раз(и)")
    expect(summary.items.map((item) => item.code)).toEqual([
      'transport_connection_reset',
      'transport_broken_pipe',
      'transport_recovery',
    ])
  })

  it('keeps unrecovered transport faults critical', () => {
    const summary = summarizeStreamLogIncidents([
      '2026-04-11T10:00:00Z Broken pipe',
      '2026-04-11T10:00:01Z Connection reset by peer',
    ], {
      nowMs: Date.parse('2026-04-11T10:05:00Z'),
    })

    expect(summary.severity).toBe('critical')
    expect(summary.items.every((item) => item.severity === 'critical')).toBe(true)
  })

  it('treats timeline drift warnings as degraded', () => {
    const summary = summarizeStreamLogIncidents([
      '2026-04-11T10:00:00Z Non-monotonic DTS in output stream 0:1; previous: 10, current: 9',
    ], {
      nowMs: Date.parse('2026-04-11T10:05:00Z'),
    })

    expect(summary.severity).toBe('degraded')
    expect(summary.headline).toBe('FFmpeg попереджає про Non-monotonic DTS 1 раз(и)')
  })

  it('ignores stale incident lines outside the recency window', () => {
    const summary = summarizeStreamLogIncidents([
      '2026-04-11T10:00:00Z Connection reset by peer',
      '2026-04-11T10:00:01Z Broken pipe',
      '2026-04-11T10:00:02Z Recovery successful',
    ], {
      nowMs: Date.parse('2026-04-11T10:30:00Z'),
    })

    expect(summary.severity).toBe('healthy')
    expect(summary.items).toEqual([])
  })
})

describe('deriveDashboardNextAction', () => {
  it('guides empty accounts to upload first', () => {
    expect(
      deriveDashboardNextAction({
        assetCount: 0,
        destinationCount: 0,
        streams: [],
      }),
    ).toEqual({ key: 'upload', href: '/dashboard/library?tab=assets' })
  })

  it('guides accounts with assets but no channels to connect', () => {
    expect(
      deriveDashboardNextAction({
        assetCount: 2,
        destinationCount: 0,
        streams: [],
      }),
    ).toEqual({ key: 'connect', href: '/dashboard/streaming' })
  })

  it('guides accounts with assets and channels but no streams to create', () => {
    expect(
      deriveDashboardNextAction({
        assetCount: 2,
        destinationCount: 1,
        streams: [],
      }),
    ).toEqual({ key: 'create', href: '/dashboard/streaming' })
  })

  it('guides configured accounts with stopped streams back to the operator surface', () => {
    expect(
      deriveDashboardNextAction({
        assetCount: 2,
        destinationCount: 1,
        streams: [createStream({ status: 'stopped' })],
      }),
    ).toEqual({ key: 'resume', href: '/dashboard/streaming' })
  })

  it('prefers live status truth over stale stream list state for next action', () => {
    const stream = createStream({ status: 'stopped' })
    const liveStatusMap = new Map<string, StreamStatusQuery>([
      [
        stream.id,
        {
          data: {
            id: stream.id,
            status: 'running',
            is_running: true,
            live_duration_seconds: 45,
            total_duration_seconds: 45,
            runtime_restart: createRestartInfo(),
          } satisfies StreamStatusResponse,
          dataUpdatedAt: Date.now(),
          isError: false,
          isFetching: false,
        },
      ],
    ])

    expect(
      deriveDashboardNextAction({
        assetCount: 2,
        destinationCount: 1,
        streams: [stream],
        liveStatusMap,
      }),
    ).toEqual({ key: 'live', href: '/dashboard/streaming' })
  })
})
