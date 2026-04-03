import {
  BUILDER_STEPS,
  createDefaultEditorState,
  DEFAULT_SCHEDULE_STATE,
  deriveEditorStateFromCollection,
  formatReviewDateTime,
  hasEditorSelection,
  isTimelineCustomized,
  validateBuilderState,
} from '../builder-helpers'
import type { MediaCollection } from '@/lib/types'

describe('stream builder helpers', () => {
  it('creates default editor state with expected toggles', () => {
    const defaultState = createDefaultEditorState()
    expect(defaultState.mode).toBe('custom')
    expect(defaultState.items).toHaveLength(0)
    expect(defaultState.loop).toBe(true)
    expect(defaultState.shuffle).toBe(false)

    const shuffled = createDefaultEditorState({ shuffle: true })
    expect(shuffled.shuffle).toBe(true)
  })

  it('derives editor state from an existing collection and sorts items', () => {
    const collection: MediaCollection = {
      id: 'col-1',
      user_id: 'user-1',
      name: 'Background loop',
      description: null,
      collection_type: 'video_background',
      is_active: true,
      origin_playlist_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      items: [
        {
          id: 'item-b',
          collection_id: 'col-1',
          asset_id: 'asset-b',
          position: 1,
          loop_mode: 'shuffle',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'item-a',
          collection_id: 'col-1',
          asset_id: 'asset-a',
          position: 0,
          loop_mode: 'once',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    }

    const state = deriveEditorStateFromCollection(collection)

    expect(state.mode).toBe('existing')
    expect(state.selectedCollectionId).toBe('col-1')
    expect(state.items.map((item) => item.asset_id)).toEqual(['asset-a', 'asset-b'])
    expect(state.shuffle).toBe(true)
    expect(state.loop).toBe(false)
  })

  it('exposes schedule defaults for live streams', () => {
    expect(DEFAULT_SCHEDULE_STATE.startMode).toBe('now')
    expect(DEFAULT_SCHEDULE_STATE.stopAt).toBe('')
    expect(DEFAULT_SCHEDULE_STATE.loopStream).toBe(true)
    expect(DEFAULT_SCHEDULE_STATE.videoVolume).toBeGreaterThan(DEFAULT_SCHEDULE_STATE.audioVolume)
  })

  it('defines the guided builder steps in wizard order', () => {
    expect(BUILDER_STEPS).toEqual(['content', 'channels', 'schedule', 'review'])
  })

  it('checks editor selection from either saved collections or picked assets', () => {
    expect(hasEditorSelection(createDefaultEditorState())).toBe(false)
    expect(
      hasEditorSelection({
        ...createDefaultEditorState(),
        selectedCollectionId: 'collection-1',
      }),
    ).toBe(true)
    expect(
      hasEditorSelection({
        ...createDefaultEditorState(),
        items: [{ asset_id: 'asset-1' }],
      }),
    ).toBe(true)
  })

  it('formats review dates with the provided app locale', () => {
    const format = jest.fn().mockReturnValue('4 квіт. 2026 р., 09:00')
    const formatterSpy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        ((locale?: string | string[]) =>
          ({
            format,
          }) as unknown as Intl.DateTimeFormat) as typeof Intl.DateTimeFormat,
      )

    expect(formatReviewDateTime('uk', '2026-04-04T09:00:00.000Z')).toBe('4 квіт. 2026 р., 09:00')
    expect(formatterSpy).toHaveBeenCalledWith('uk', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })

    formatterSpy.mockRestore()
  })

  it('tracks timeline customisation from actual editor state instead of disclosure state', () => {
    expect(
      isTimelineCustomized({
        videoEditor: {
          ...createDefaultEditorState(),
          mode: 'existing',
          selectedCollectionId: 'video-collection',
          items: [{ asset_id: 'video-1' }],
        },
        audioEnabled: true,
        audioEditor: {
          ...createDefaultEditorState({ shuffle: true }),
          mode: 'existing',
          selectedCollectionId: 'audio-collection',
          items: [{ asset_id: 'audio-1' }],
        },
      }),
    ).toBe(false)

    expect(
      isTimelineCustomized({
        videoEditor: {
          ...createDefaultEditorState(),
          items: [{ asset_id: 'video-1' }],
        },
        audioEnabled: false,
        audioEditor: createDefaultEditorState({ shuffle: true }),
      }),
    ).toBe(true)
  })

  it('routes validation failures back to the guided step that needs attention', () => {
    expect(
      validateBuilderState({
        hasVideoSelection: false,
        audioEnabled: false,
        hasAudioSelection: false,
        selectedDestinationCount: 1,
        scheduleState: DEFAULT_SCHEDULE_STATE,
      }),
    ).toEqual({
      step: 'content',
      errorKey: 'errors.selectBackground',
    })

    expect(
      validateBuilderState({
        hasVideoSelection: true,
        audioEnabled: true,
        hasAudioSelection: false,
        selectedDestinationCount: 1,
        scheduleState: DEFAULT_SCHEDULE_STATE,
      }),
    ).toEqual({
      step: 'content',
      errorKey: 'errors.selectAudio',
    })

    expect(
      validateBuilderState({
        hasVideoSelection: true,
        audioEnabled: false,
        hasAudioSelection: false,
        selectedDestinationCount: 0,
        scheduleState: DEFAULT_SCHEDULE_STATE,
      }),
    ).toEqual({
      step: 'channels',
      errorKey: 'errors.selectDestination',
    })

    expect(
      validateBuilderState({
        hasVideoSelection: true,
        audioEnabled: false,
        hasAudioSelection: false,
        selectedDestinationCount: 1,
        scheduleState: {
          ...DEFAULT_SCHEDULE_STATE,
          startMode: 'schedule',
          startAt: '',
        },
      }),
    ).toEqual({
      step: 'schedule',
      errorKey: 'errors.scheduleTime',
    })
  })
})
