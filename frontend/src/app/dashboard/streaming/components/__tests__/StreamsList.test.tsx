import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { NextIntlClientProvider, type AbstractIntlMessages, type TranslationValues } from 'next-intl'

import { StreamsList } from '../StreamsList'
import type {
  MediaCollection,
  Playlist,
  Stream,
  StreamRuntimeRestartInfo,
  StreamStatusValue,
} from '@/lib/types'

const translations: Record<string, string> = {
  'streams.title': 'Live Streams',
  'streams.new': 'New Stream',
  'streams.untitled': 'Untitled Stream',
  'streams.labels.source': 'Source',
  'streams.labels.destinations': 'Channel',
  'streams.labels.status': 'Status',
  'streams.labels.created': 'Created',
  'streams.labels.liveDuration': 'Live duration',
  'streams.labels.totalDuration': 'Total duration',
  'streams.labels.quotaRemaining': 'Daily quota remaining',
  'streams.labels.scheduledStart': 'Scheduled start',
  'streams.labels.autoRetry': 'Auto-restart',
  'streams.destinations.none': 'No destinations configured',
  'streams.sources.videoCollection': 'Video queue',
  'streams.sources.audioCollection': 'Audio playlist',
  'streams.sources.customQueue': 'Custom queue ({count})',
  'streams.unknownPlaylist': 'Unknown playlist',
  'streams.statusCheck.unreachable': 'Live status unavailable',
  'streams.buttons.logs': 'Logs',
  'streams.buttons.schedule': 'Schedule',
  'streams.buttons.stop': 'Stop',
  'streams.buttons.start': 'Start',
  'streams.buttons.cancelSchedule': 'Cancel schedule',
  'streams.buttons.details': 'Details',
  'streams.buttons.delete': 'Delete',
  'streams.deleteConfirm.title': 'Delete stream?',
  'streams.deleteConfirm.description': 'This permanently removes "{name}" and its stream data.',
  'streams.deleteConfirm.cancel': 'Keep stream',
  'streams.deleteConfirm.confirm': 'Delete stream',
  'streams.buttons.reviewIssue': 'Review issue',
  'streams.liveEdit.button': 'Edit',
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
  'streams.sections.live': 'Live',
  'streams.sections.attention': 'Attention',
  'streams.sections.scheduled': 'Scheduled',
  'streams.sections.stopped': 'Stopped',
  'streams.quota.limitReached': 'Limit reached',
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

function openDropdownFor(card: HTMLElement) {
  const trigger = within(card).getByRole('button', { name: 'More actions' })
  fireEvent.click(trigger)
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
  const videoCollectionMap = new Map<string, MediaCollection>([
    [
      'video-collection-1',
      {
        id: 'video-collection-1',
        user_id: 'user-1',
        name: 'Loop queue',
        description: null,
        collection_type: 'video_background',
        is_active: true,
        origin_playlist_id: null,
        created_at: '2026-03-30T08:00:00Z',
        updated_at: '2026-03-30T08:00:00Z',
        items: [],
      },
    ],
  ])
  const audioCollectionMap = new Map<string, MediaCollection>()

  const renderStatusBadge = (status: StreamStatusValue): ReactNode => <span>{status}</span>

  function renderList(
    streams: Stream[],
    overrides: Partial<ComponentProps<typeof StreamsList>> = {},
  ) {
    render(
      <NextIntlClientProvider locale="en" messages={{} as AbstractIntlMessages}>
        <StreamsList
          streams={streams}
          isLoading={false}
          onCreateStream={jest.fn()}
          onViewLogs={jest.fn()}
          onOpenLiveEditor={jest.fn()}
          onEditSchedule={jest.fn()}
          onStartStream={jest.fn()}
          onStopStream={jest.fn()}
          onDeleteStream={jest.fn()}
          renderStatusBadge={renderStatusBadge}
          playlistMap={playlistMap}
          videoCollectionMap={videoCollectionMap}
          audioCollectionMap={audioCollectionMap}
          t={t}
          streamingStatus={(status) => status}
          pendingStartStreamId={null}
          pendingStopStreamId={null}
          pendingDeleteStreamId={null}
          {...overrides}
        />
      </NextIntlClientProvider>,
    )
  }

  it('renders retry details from stream list runtime restart data', () => {
    const stream = createStream({
      error_message: 'runner lost lease',
      runtime_restart: createRestartInfo({
        state: 'scheduled',
        attempts: 2,
        next_restart_at: new Date(Date.now() + 30_000).toISOString(),
        last_failure_at: new Date(Date.now() - 15_000).toISOString(),
      }),
    })

    renderList([stream])

    expect(screen.getByText('Attempt 2 of 5')).toBeInTheDocument()
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
    expect(screen.queryByText('Attempt 0 of 5')).not.toBeInTheDocument()
  })

  it('uses stream list status for the action button', () => {
    const onStartStream = jest.fn()
    const onStopStream = jest.fn()
    const stream = createStream({
      id: 'stream-live',
      status: 'running',
      name: 'Live stream',
      error_message: null,
      runtime_restart: createRestartInfo(),
    })

    render(
      <NextIntlClientProvider locale="en" messages={{} as AbstractIntlMessages}>
        <StreamsList
          streams={[stream]}
          isLoading={false}
          onCreateStream={jest.fn()}
          onViewLogs={jest.fn()}
          onOpenLiveEditor={jest.fn()}
          onEditSchedule={jest.fn()}
          onStartStream={onStartStream}
          onStopStream={onStopStream}
          onDeleteStream={jest.fn()}
          renderStatusBadge={renderStatusBadge}
          playlistMap={playlistMap}
          videoCollectionMap={videoCollectionMap}
          audioCollectionMap={audioCollectionMap}
          t={t}
          streamingStatus={(status) => status}
          pendingStartStreamId={null}
          pendingStopStreamId={null}
          pendingDeleteStreamId={null}
        />
      </NextIntlClientProvider>,
    )

    const stopButton = screen.getByRole('button', { name: 'Stop' })
    expect(stopButton).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()

    fireEvent.click(stopButton)

    expect(onStopStream).toHaveBeenCalledWith(stream.id)
    expect(onStartStream).not.toHaveBeenCalled()
  })

  it('shows collection-backed streams with a real source label instead of an unknown playlist', () => {
    renderList([
      createStream({
        id: 'stream-collection',
        source_type: 'assets',
        playlist_id: null,
        video_collection_id: 'video-collection-1',
        total_duration_seconds: 0,
      }),
    ])

    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByText('Loop queue')).toBeInTheDocument()
    expect(screen.queryByText('Unknown playlist')).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('confirms stream deletion before calling the destructive action', () => {
    const onDeleteStream = jest.fn()
    renderList(
      [createStream({ id: 'stream-delete', runtime_restart: createRestartInfo({ enabled: false }) })],
      { onDeleteStream },
    )

    const card = screen.getByText('Retry stream').closest('article')!
    openDropdownFor(card)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onDeleteStream).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete stream' }))

    expect(onDeleteStream).toHaveBeenCalledWith('stream-delete')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps pending action state scoped to the active stream row', () => {
    const running = createStream({
      id: 'stream-running',
      name: 'Running stream',
      status: 'running',
      runtime_restart: createRestartInfo({ enabled: false }),
    })
    const stopped = createStream({
      id: 'stream-stopped',
      name: 'Stopped stream',
      status: 'stopped',
      runtime_restart: createRestartInfo({ enabled: false }),
    })

    renderList([running, stopped], {
      pendingStopStreamId: 'stream-running',
      pendingDeleteStreamId: null,
      pendingStartStreamId: null,
    })

    const runningCard = screen.getByText('Running stream').closest('article')!
    const stoppedCard = screen.getByText('Stopped stream').closest('article')!

    expect(within(runningCard).getByRole('button', { name: 'Stop' })).toBeDisabled()
    expect(within(stoppedCard).getByRole('button', { name: 'Start' })).toBeEnabled()

    // Delete is inside the dropdown — open it and check
    openDropdownFor(stoppedCard)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('shows audio-only collection sources without falling back to unknown playlist', () => {
    const audioOnlyCollection = new Map<string, MediaCollection>([
      [
        'audio-collection-1',
        {
          id: 'audio-collection-1',
          user_id: 'user-1',
          name: 'Audio-only collection',
          description: null,
          collection_type: 'audio_playlist',
          is_active: true,
          origin_playlist_id: null,
          created_at: '2026-03-30T08:00:00Z',
          updated_at: '2026-03-30T08:00:00Z',
          items: [],
        },
      ],
    ])

    render(
      <NextIntlClientProvider locale="en" messages={{} as AbstractIntlMessages}>
        <StreamsList
          streams={[
            createStream({
              id: 'stream-audio-only',
              playlist_id: null,
              video_collection_id: null,
              audio_collection_id: 'audio-collection-1',
              mix_mode: 'audio_only',
              source_type: 'assets',
            }),
          ]}
          isLoading={false}
          onCreateStream={jest.fn()}
          onViewLogs={jest.fn()}
          onOpenLiveEditor={jest.fn()}
          onEditSchedule={jest.fn()}
          onStartStream={jest.fn()}
          onStopStream={jest.fn()}
          onDeleteStream={jest.fn()}
          renderStatusBadge={renderStatusBadge}
          playlistMap={playlistMap}
          videoCollectionMap={videoCollectionMap}
          audioCollectionMap={audioOnlyCollection}
          t={t}
          streamingStatus={(status) => status}
          pendingStartStreamId={null}
          pendingStopStreamId={null}
          pendingDeleteStreamId={null}
        />
      </NextIntlClientProvider>,
    )

    expect(screen.getByText('Audio-only collection')).toBeInTheDocument()
    expect(screen.queryByText('Unknown playlist')).not.toBeInTheDocument()
  })

  it('shows custom queue source labels for stream assets fallback', () => {
    renderList([
      createStream({
        id: 'stream-custom-queue',
        playlist_id: null,
        video_collection_id: null,
        audio_collection_id: null,
        source_type: 'assets',
        stream_assets: [{ asset_id: 'asset-1', position: 0 }, { asset_id: 'asset-2', position: 1 }] as Stream['stream_assets'],
      }),
    ])

    expect(screen.getByText('Custom queue (2)')).toBeInTheDocument()
  })
})
