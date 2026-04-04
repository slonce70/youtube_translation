import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider, type AbstractIntlMessages, type TranslationValues } from 'next-intl'

import { StreamBuilderModal } from '../StreamBuilderModal'
import enMessages from '@/messages/en'

jest.mock('../../hooks/useStreamBuilder', () => ({
  useStreamBuilder: jest.fn(),
}))

const { useStreamBuilder } = jest.requireMock('../../hooks/useStreamBuilder') as {
  useStreamBuilder: jest.Mock
}

const streamingPageMessages = (
  enMessages as unknown as {
    streaming: {
      page: Record<string, unknown>
    }
  }
).streaming.page

function lookupMessage(source: Record<string, unknown>, key: string): string {
  const value = key.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part]
    }
    return undefined
  }, source)

  return typeof value === 'string' ? value : key
}

function t(key: string, values?: TranslationValues): string {
  const template = lookupMessage(streamingPageMessages, key)
  if (!values) {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (_, token) => String(values[token] ?? ''))
}

function createBuilderState(overrides: Record<string, unknown> = {}) {
  return {
    streamForm: {
      name: 'Night stream',
      destination_ids: ['dest-1'],
    },
    setStreamForm: jest.fn(),
    activeBuilderTab: 'content',
    setActiveBuilderTab: jest.fn(),
    builderTabsList: ['content', 'channels', 'schedule', 'review'],
    currentTabIndex: 0,
    isFinalTab: false,
    audioEnabled: true,
    videoEditor: {
      selectedCollectionId: null,
      items: [{ asset_id: 'video-1' }],
      mode: 'custom',
      loop: true,
      shuffle: false,
      name: '',
    },
    audioEditor: {
      selectedCollectionId: null,
      items: [{ asset_id: 'audio-1' }],
      mode: 'custom',
      loop: true,
      shuffle: true,
      name: '',
    },
    scheduleState: {
      startMode: 'now',
      startAt: '',
      stopAt: '',
      loopStream: true,
      videoVolume: 85,
      audioVolume: 70,
    },
    setScheduleState: jest.fn(),
    addAssetToEditor: jest.fn(),
    removeAssetFromEditor: jest.fn(),
    handleItemDragStart: jest.fn(),
    handleItemDrop: jest.fn(),
    handleSelectCollection: jest.fn(),
    handleCustomizeExisting: jest.fn(),
    handleDestinationToggle: jest.fn(),
    handleAudioToggle: jest.fn(),
    handleBuilderSubmit: jest.fn(),
    isBuilderSubmitting: false,
    createPending: false,
    videoAssets: [
      { id: 'video-1', filename: 'video.mp4', asset_type: 'video' },
    ],
    audioAssets: [
      { id: 'audio-1', filename: 'track.mp3', asset_type: 'audio' },
    ],
    assetMap: new Map([
      ['video-1', { id: 'video-1', filename: 'video.mp4', asset_type: 'video' }],
      ['audio-1', { id: 'audio-1', filename: 'track.mp3', asset_type: 'audio' }],
    ]),
    destinations: [
      {
        id: 'dest-1',
        name: 'Main channel',
        rtmps_url: 'rtmps://example.test/live',
        enabled: true,
      },
    ],
    resetBuilderState: jest.fn(),
    runningStreams: [],
    errorStreams: [],
    concurrentStreamsLimit: 2,
    updateEditor: jest.fn(),
    reorderEditorItems: jest.fn(),
    ...overrides,
  }
}

function renderModal(builderStateOverrides: Record<string, unknown> = {}) {
  useStreamBuilder.mockReturnValue(createBuilderState(builderStateOverrides))

  return render(
    <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
      <StreamBuilderModal
        open
        onClose={jest.fn()}
        onOpenChannelForm={jest.fn()}
        destinations={[]}
        isLoadingDestinations={false}
        assets={[]}
        isLoadingAssets={false}
        videoCollections={[]}
        isLoadingVideoCollections={false}
        audioCollections={[]}
        isLoadingAudioCollections={false}
        quota={undefined}
        streams={[]}
        t={t}
        streamingToasts={jest.fn((key: string) => key)}
        formatLimitValue={(value) => (value == null ? '∞' : String(value))}
      />
    </NextIntlClientProvider>,
  )
}

describe('StreamBuilderModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the guided wizard steps instead of the old expert tab set', () => {
    renderModal()

    expect(screen.getByText('Content')).toBeInTheDocument()
    expect(screen.getByText('Channels')).toBeInTheDocument()
    expect(screen.getByText('Schedule')).toBeInTheDocument()
    expect(screen.getByText('Review & Launch')).toBeInTheDocument()
    expect(screen.queryByText('Studio timeline')).not.toBeInTheDocument()
  })

  it('keeps timeline editing behind advanced disclosure on the content step', () => {
    renderModal()

    expect(screen.queryByText('Studio timeline')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Advanced timeline'))

    expect(screen.getByText('Studio timeline')).toBeInTheDocument()
    expect(screen.getByText('Visual overview of your stream content')).toBeInTheDocument()
  })

  it('keeps the guided content flow stacked in playback-first order', () => {
    renderModal()

    const playbackOrder = screen.getByText('Playback order')
    const videoAssets = screen.getByText('Available video assets')
    const audioPlaylist = screen.getByText('Audio playlist')
    const advancedTimeline = screen.getByText('Advanced timeline')

    expect(playbackOrder.compareDocumentPosition(videoAssets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(videoAssets.compareDocumentPosition(audioPlaylist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(audioPlaylist.compareDocumentPosition(advancedTimeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('treats audio as opt-in in the guided content step', () => {
    renderModal({
      audioEnabled: false,
      audioEditor: {
        selectedCollectionId: null,
        items: [],
        mode: 'custom',
        loop: true,
        shuffle: true,
        name: '',
      },
    })

    expect(screen.getByRole('button', { name: 'Enable audio' })).toBeInTheDocument()
    expect(screen.getByText('Audio is disabled. Enable it to add playlists.')).toBeInTheDocument()
    expect(screen.queryByText('No audio tracks selected')).not.toBeInTheDocument()
  })

  it('shows a review summary with jump-back actions before launch', () => {
    renderModal({
      activeBuilderTab: 'review',
      currentTabIndex: 3,
      isFinalTab: true,
      scheduleState: {
        startMode: 'schedule',
        startAt: '2026-04-04T09:00',
        stopAt: '2026-04-04T21:00',
        loopStream: true,
        videoVolume: 80,
        audioVolume: 55,
      },
    })

    expect(screen.getAllByText('Review & Launch')).toHaveLength(2)
    expect(screen.getByText('Content setup')).toBeInTheDocument()
    expect(screen.getByText('Selected channels')).toBeInTheDocument()
    expect(screen.getByText('Schedule & playback')).toBeInTheDocument()
    expect(screen.getByText('Edit content')).toBeInTheDocument()
    expect(screen.getByText('Edit channels')).toBeInTheDocument()
    expect(screen.getByText('Edit schedule')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create stream' })).toBeInTheDocument()
  })

  it('derives the review timeline summary from builder state rather than disclosure visibility', () => {
    renderModal({
      activeBuilderTab: 'review',
      currentTabIndex: 3,
      isFinalTab: true,
      videoEditor: {
        selectedCollectionId: 'video-collection',
        items: [{ asset_id: 'video-1' }],
        mode: 'existing',
        loop: true,
        shuffle: false,
        name: 'Saved video collection',
      },
      audioEditor: {
        selectedCollectionId: 'audio-collection',
        items: [{ asset_id: 'audio-1' }],
        mode: 'existing',
        loop: true,
        shuffle: true,
        name: 'Saved audio collection',
      },
    })

    expect(screen.getByText('Using the default playback order')).toBeInTheDocument()
    expect(screen.queryByText('Timeline was customised')).not.toBeInTheDocument()
  })

  it('clears saved video collection bindings when the queue is reset', () => {
    const updateEditor = jest.fn()

    renderModal({
      updateEditor,
      videoEditor: {
        selectedCollectionId: 'video-collection',
        items: [{ asset_id: 'video-1' }],
        mode: 'existing',
        loop: true,
        shuffle: false,
        name: 'Saved video collection',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(updateEditor).toHaveBeenCalledWith('video', expect.any(Function))

    const updater = updateEditor.mock.calls[0][1] as (state: Record<string, unknown>) => Record<string, unknown>
    expect(
      updater({
        selectedCollectionId: 'video-collection',
        items: [{ asset_id: 'video-1' }],
        mode: 'existing',
        loop: true,
        shuffle: false,
        name: 'Saved video collection',
      }),
    ).toEqual({
      selectedCollectionId: null,
      items: [],
      mode: 'custom',
      loop: true,
      shuffle: false,
      name: 'Saved video collection',
    })
  })

  it('shows item counts in review when a saved collection was customised', () => {
    renderModal({
      activeBuilderTab: 'review',
      currentTabIndex: 3,
      isFinalTab: true,
      videoEditor: {
        selectedCollectionId: 'video-collection',
        items: [{ asset_id: 'video-1' }],
        mode: 'custom',
        loop: false,
        shuffle: false,
        name: 'Saved video collection',
      },
      audioEditor: {
        selectedCollectionId: 'audio-collection',
        items: [{ asset_id: 'audio-1' }],
        mode: 'custom',
        loop: true,
        shuffle: false,
        name: 'Saved audio collection',
      },
    })

    expect(screen.getByText('Video assets: 1')).toBeInTheDocument()
    expect(screen.getByText('Audio tracks: 1')).toBeInTheDocument()
    expect(screen.queryByText('Video: saved collection')).not.toBeInTheDocument()
    expect(screen.queryByText('Audio: saved playlist')).not.toBeInTheDocument()
  })
})
