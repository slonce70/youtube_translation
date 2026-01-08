import { createDefaultEditorState, DEFAULT_SCHEDULE_STATE, deriveEditorStateFromCollection } from '../builder-helpers'
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
})
