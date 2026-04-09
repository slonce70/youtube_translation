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
  if (!values) return template
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
    videoAssets: [{ id: 'video-1', filename: 'video.mp4', asset_type: 'video', size_bytes: 0, created_at: '', updated_at: '', storage_path: '', compatible_for_copy: true, optimization: { status: 'not_requested', recommended_strategy: 'copy', can_stream_from_source: true } }],
    audioAssets: [{ id: 'audio-1', filename: 'track.mp3', asset_type: 'audio', size_bytes: 0, created_at: '', updated_at: '', storage_path: '', compatible_for_copy: true, optimization: { status: 'not_requested', recommended_strategy: 'copy', can_stream_from_source: true } }],
    assetMap: new Map([
      ['video-1', { id: 'video-1', filename: 'video.mp4', asset_type: 'video' }],
      ['audio-1', { id: 'audio-1', filename: 'track.mp3', asset_type: 'audio' }],
    ]),
    destinations: [{ id: 'dest-1', name: 'Main channel', rtmps_url: 'rtmps://example.test/live', enabled: true, stream_key_masked: '****', created_at: '', updated_at: '' }],
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
    document.body.style.overflow = ''
  })

  it('renders the new single-screen 3-step layout', () => {
    renderModal()

    expect(screen.getByText('📡 Нова трансляція')).toBeInTheDocument()
    expect(screen.getByText('1 · Оберіть канал')).toBeInTheDocument()
    expect(screen.getByText('2 · Джерело відео')).toBeInTheDocument()
    expect(screen.getByText('3 · Налаштування')).toBeInTheDocument()
    expect(screen.getByText('📋 Підсумок трансляції')).toBeInTheDocument()
    expect(screen.getByText('✅ Готовність')).toBeInTheDocument()
  })

  it('shows selected destination and source in the sticky summary', () => {
    renderModal()

    expect(screen.getAllByText('Main channel').length).toBeGreaterThan(0)
    expect(screen.getAllByText('video.mp4').length).toBeGreaterThan(0)
    expect(screen.getByText('Одразу після запуску')).toBeInTheDocument()
  })

  it('switches between file and playlist source tabs', () => {
    const handleSelectCollection = jest.fn()
    renderModal({
      handleSelectCollection,
      videoCollections: [{ id: 'collection-1', name: 'Saved playlist', items: [{ asset_id: 'video-1' }] }],
      videoEditor: {
        selectedCollectionId: null,
        items: [],
        mode: 'custom',
        loop: true,
        shuffle: false,
        name: '',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '📋 Плейлист' }))

    expect(handleSelectCollection).not.toHaveBeenCalled()
  })

  it('shows readiness errors when required fields are missing', () => {
    renderModal({
      streamForm: { name: '', destination_ids: [] },
      videoEditor: { selectedCollectionId: null, items: [], mode: 'custom', loop: true, shuffle: false, name: '' },
      audioEditor: { selectedCollectionId: null, items: [], mode: 'custom', loop: true, shuffle: true, name: '' },
      audioEnabled: false,
    })

    expect(screen.getByText('✗ Оберіть канал')).toBeInTheDocument()
    expect(screen.getByText('✗ Файл обрано')).toBeInTheDocument()
    expect(screen.getByText('✗ Введіть назву')).toBeInTheDocument()
  })

  it('calls audio toggle via the new settings section button', () => {
    const handleAudioToggle = jest.fn()
    renderModal({ audioEnabled: false, handleAudioToggle })

    fireEvent.click(screen.getByRole('button', { name: '🎵 Додати аудіо' }))

    expect(handleAudioToggle).toHaveBeenCalledWith(true)
  })

  it('locks body scroll while the builder modal is open', () => {
    const view = renderModal()

    expect(document.body.style.overflow).toBe('hidden')

    view.unmount()

    expect(document.body.style.overflow).toBe('')
  })
})
