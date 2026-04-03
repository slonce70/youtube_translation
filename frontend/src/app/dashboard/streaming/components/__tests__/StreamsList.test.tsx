import { fireEvent, render, screen } from '@testing-library/react'
import { enUS } from 'date-fns/locale'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { TranslationValues } from 'next-intl'

import { StreamsList } from '../StreamsList'
import type {
  Playlist,
  Stream,
  StreamRuntimeRestartInfo,
  StreamStatusResponse,
  StreamStatusValue,
} from '@/lib/types'

const translations: Record<string, string> = {
  'streams.title': 'Live Streams',
  'streams.new': 'New Stream',
  'streams.untitled': 'Untitled Stream',
  'streams.labels.playlist': 'Playlist',
  'streams.labels.destinations': 'Channel',
  'streams.labels.status': 'Status',
  'streams.labels.created': 'Created',
  'streams.labels.liveDuration': 'Live duration',
  'streams.labels.totalDuration': 'Total duration',
  'streams.labels.quotaRemaining': 'Daily quota remaining',
  'streams.labels.scheduledStart': 'Scheduled start',
  'streams.labels.autoRetry': 'Auto-restart',
  'streams.destinations.none': 'No destinations configured',
  'streams.unknownPlaylist': 'Unknown playlist',
  'streams.statusCheck.unreachable': 'Live status unavailable',
  'streams.buttons.logs': 'Logs',
  'streams.buttons.schedule': 'Schedule',
  'streams.buttons.stop': 'Stop',
  'streams.buttons.start': 'Start',
  'streams.buttons.cancelSchedule': 'Cancel schedule',
  'streams.empty.title': 'No streams',
  'streams.empty.description': 'Nothing here yet',
  'streams.empty.cta': 'Create stream',
  'streams.retry.scheduled': 'Auto-restart scheduled',
  'streams.retry.nextRestart': 'Next restart {value}',
  'streams.retry.attempt': 'Attempt {current} of {max}',
  'streams.retry.lastRestartLabel': 'Last retry',
  'streams.retry.lastRestart': 'Restarted {value}',
  'streams.retry.lastFailure': 'Last failure {value}',
  'streams.retry.exhausted': 'Auto-restart budget exhausted after {count} attempts',
}

function t(key: string, values?: TranslationValues): string {
  const template = translations[key] ?? key
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (_, token) => String(values[token] ?? ''))
}

function createRestartInfo(
  overrides: Partial<StreamRuntimeRestartInfo> = {},
): StreamRuntimeRestartInfo {
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

function createStream(
  overrides: Partial<Stream> = {},
): Stream {
  return {
    id: 'stream-1',
    playlist_id: 'playlist-1',
    source_type: 'playlist',
    name: 'Retry stream',
    status: 'error',
    pid: null,
    log_path: null,
    error_message: 'ffmpeg crashed',
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
    destinations: [{ id: 'dest-1', name: 'YouTube', rtmps_url: 'rtmps://example.test/live', enabled: true }],
    scheduled_start_enabled: false,
    scheduled_start_time: null,
    scheduled_stop_time: null,
    uptime_seconds: 0,
    runtime_restart: createRestartInfo(),
    ...overrides,
  }
}

function createStatusQuery(
  data?: StreamStatusResponse,
): UseQueryResult<StreamStatusResponse> {
  return {
    data,
    dataUpdatedAt: Date.now(),
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    fetchStatus: 'idle',
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isInitialLoading: false,
    isLoading: false,
    isLoadingError: false,
    isPaused: false,
    isPending: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: true,
    refetch: jest.fn(),
    remove: jest.fn(),
    status: 'success',
  } as unknown as UseQueryResult<StreamStatusResponse>
}

describe('StreamsList restart visibility', () => {
  const playlistMap = new Map<string, Playlist>([
    [
      'playlist-1',
      {
        id: 'playlist-1',
        name: 'Main playlist',
        description: null,
        loop: true,
        items: [],
        created_at: '2026-03-30T08:00:00Z',
        updated_at: '2026-03-30T08:00:00Z',
      },
    ],
  ])

  const renderStatusBadge = (status: StreamStatusValue): ReactNode => <span>{status}</span>

  function renderList(streams: Stream[], liveStatusMap?: Map<string, UseQueryResult<StreamStatusResponse>>) {
    render(
      <StreamsList
        streams={streams}
        isLoading={false}
        liveStatusMap={liveStatusMap ?? new Map()}
        onCreateStream={jest.fn()}
        onViewLogs={jest.fn()}
        onOpenLiveEditor={jest.fn()}
        onEditSchedule={jest.fn()}
        onStartStream={jest.fn()}
        onStopStream={jest.fn()}
        onDeleteStream={jest.fn()}
        renderStatusBadge={renderStatusBadge}
        playlistMap={playlistMap}
        t={t}
        streamingStatus={(status) => status}
        dateLocale={enUS}
        isStartPending={false}
        isStopPending={false}
        isDeletePending={false}
      />,
    )
  }

  it('prefers live status restart data over stale list data', () => {
    const stream = createStream({
      runtime_restart: createRestartInfo({
        state: 'idle',
      }),
    })
    const nextRestartAt = new Date(Date.now() + 30_000).toISOString()
    const statusData: StreamStatusResponse = {
      id: stream.id,
      status: 'error',
      is_running: false,
      error_message: 'runner lost lease',
      runtime_restart: createRestartInfo({
        state: 'scheduled',
        attempts: 2,
        next_restart_at: nextRestartAt,
        last_failure_at: new Date(Date.now() - 15_000).toISOString(),
      }),
    }

    renderList([stream], new Map([[stream.id, createStatusQuery(statusData)]]))

    expect(screen.getByText('Auto-restart scheduled')).toBeInTheDocument()
    expect(screen.getByText('Attempt 2 of 5')).toBeInTheDocument()
    expect(screen.getByText(/Next restart/)).toBeInTheDocument()
    expect(screen.getByText('runner lost lease')).toBeInTheDocument()
  })

  it('falls back to list restart data and hides idle blocks', () => {
    const retryingStream = createStream({
      id: 'stream-2',
      name: 'Fallback retry',
      runtime_restart: createRestartInfo({
        state: 'scheduled',
        attempts: 1,
        next_restart_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    })
    const idleStream = createStream({
      id: 'stream-3',
      name: 'Idle stream',
      runtime_restart: createRestartInfo({
        state: 'idle',
        attempts: 0,
      }),
    })

    renderList([retryingStream, idleStream])

    expect(screen.getByText('Fallback retry')).toBeInTheDocument()
    expect(screen.getByText('Attempt 1 of 5')).toBeInTheDocument()
    expect(screen.getAllByText('Auto-restart').length).toBe(1)
    expect(screen.queryByText('Attempt 0 of 5')).not.toBeInTheDocument()
  })

  it('uses live running status for the action button when the list is stale', () => {
    const onStartStream = jest.fn()
    const onStopStream = jest.fn()
    const stream = createStream({
      id: 'stream-live',
      status: 'stopped',
      name: 'Live stream',
      error_message: null,
      runtime_restart: createRestartInfo(),
    })
    const statusData: StreamStatusResponse = {
      id: stream.id,
      status: 'running',
      is_running: true,
      error_message: null,
      live_duration_seconds: 12,
      total_duration_seconds: 12,
      runtime_restart: createRestartInfo(),
    }

    render(
      <StreamsList
        streams={[stream]}
        isLoading={false}
        liveStatusMap={new Map([[stream.id, createStatusQuery(statusData)]])}
        onCreateStream={jest.fn()}
        onViewLogs={jest.fn()}
        onOpenLiveEditor={jest.fn()}
        onEditSchedule={jest.fn()}
        onStartStream={onStartStream}
        onStopStream={onStopStream}
        onDeleteStream={jest.fn()}
        renderStatusBadge={renderStatusBadge}
        playlistMap={playlistMap}
        t={t}
        streamingStatus={(status) => status}
        dateLocale={enUS}
        isStartPending={false}
        isStopPending={false}
        isDeletePending={false}
      />,
    )

    const stopButton = screen.getByRole('button', { name: 'Stop' })
    expect(stopButton).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()

    fireEvent.click(stopButton)

    expect(onStopStream).toHaveBeenCalledWith(stream.id)
    expect(onStartStream).not.toHaveBeenCalled()
  })
})
