import type { MediaCollection } from '@/lib/types'

export type CollectionEditorItem = {
  asset_id: string
}

export type CollectionEditorState = {
  mode: 'custom' | 'existing'
  selectedCollectionId: string | null
  name: string
  items: CollectionEditorItem[]
  shuffle: boolean
  loop: boolean
}

export type ScheduleState = {
  startMode: 'now' | 'schedule'
  startAt: string
  loopStream: boolean
  videoVolume: number
  audioVolume: number
}

export const createDefaultEditorState = (options?: { shuffle?: boolean }): CollectionEditorState => ({
  mode: 'custom',
  selectedCollectionId: null,
  name: '',
  items: [],
  shuffle: options?.shuffle ?? false,
  loop: true,
})

export const DEFAULT_SCHEDULE_STATE: ScheduleState = {
  startMode: 'now',
  startAt: '',
  loopStream: true,
  videoVolume: 85,
  audioVolume: 70,
}

export const deriveEditorStateFromCollection = (
  collection: MediaCollection
): CollectionEditorState => ({
  mode: 'existing',
  selectedCollectionId: collection.id,
  name: collection.name,
  items: [...collection.items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({ asset_id: item.asset_id })),
  shuffle: collection.items.some((item) => item.loop_mode === 'shuffle'),
  loop: collection.items.every((item) => item.loop_mode !== 'once'),
})
