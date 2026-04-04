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
  stopAt: string
  loopStream: boolean
  videoVolume: number
  audioVolume: number
}

export const BUILDER_STEPS = ['content', 'channels', 'schedule', 'review'] as const

export type BuilderStep = (typeof BUILDER_STEPS)[number]

type BuilderValidationInput = {
  hasVideoSelection: boolean
  audioEnabled: boolean
  hasAudioSelection: boolean
  selectedDestinationCount: number
  scheduleState: ScheduleState
  now?: Date
}

export type BuilderValidationResult =
  | { step: 'content'; errorKey: 'errors.selectBackground' | 'errors.selectAudio' }
  | { step: 'channels'; errorKey: 'errors.selectDestination' }
  | {
      step: 'schedule'
      errorKey:
        | 'errors.scheduleTime'
        | 'errors.scheduleStopTime'
        | 'errors.scheduleStopAfterStart'
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
  stopAt: '',
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
    .map((item) => ({ 
      asset_id: item.asset_id,
      ...(item.asset ? { asset: item.asset } : {}),
    })),
  shuffle: collection.items.some((item) => item.loop_mode === 'shuffle'),
  loop: collection.items.every((item) => item.loop_mode !== 'once'),
})

export const hasEditorSelection = (editor: CollectionEditorState) =>
  Boolean(editor.selectedCollectionId) || editor.items.length > 0

export const customizeEditorState = (
  editor: CollectionEditorState,
  overrides: Partial<CollectionEditorState> = {},
): CollectionEditorState => ({
  ...editor,
  ...overrides,
  mode: 'custom',
  selectedCollectionId: null,
})

export const formatReviewDateTime = (locale: string, value: string) => {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export const isTimelineCustomized = ({
  videoEditor,
  audioEnabled,
  audioEditor,
}: {
  videoEditor: CollectionEditorState
  audioEnabled: boolean
  audioEditor: CollectionEditorState
}) => {
  const playbackEditors: Array<{ editor: CollectionEditorState; defaultShuffle: boolean }> = [
    { editor: videoEditor, defaultShuffle: false },
  ]

  if (audioEnabled) {
    playbackEditors.push({ editor: audioEditor, defaultShuffle: true })
  }

  return playbackEditors.some(({ editor, defaultShuffle }) => {
    if (!hasEditorSelection(editor)) {
      return false
    }

    return editor.mode === 'custom' || editor.loop !== true || editor.shuffle !== defaultShuffle
  })
}

export const validateBuilderState = ({
  hasVideoSelection,
  audioEnabled,
  hasAudioSelection,
  selectedDestinationCount,
  scheduleState,
  now = new Date(),
}: BuilderValidationInput): BuilderValidationResult | null => {
  if (!hasVideoSelection) {
    return { step: 'content', errorKey: 'errors.selectBackground' }
  }

  if (audioEnabled && !hasAudioSelection) {
    return { step: 'content', errorKey: 'errors.selectAudio' }
  }

  if (selectedDestinationCount === 0) {
    return { step: 'channels', errorKey: 'errors.selectDestination' }
  }

  if (scheduleState.startMode === 'schedule' && !scheduleState.startAt) {
    return { step: 'schedule', errorKey: 'errors.scheduleTime' }
  }

  if (scheduleState.stopAt) {
    const stopAt = new Date(scheduleState.stopAt)
    if (Number.isNaN(stopAt.getTime()) || stopAt <= now) {
      return { step: 'schedule', errorKey: 'errors.scheduleStopTime' }
    }

    if (scheduleState.startMode === 'schedule' && scheduleState.startAt) {
      const startAt = new Date(scheduleState.startAt)
      if (stopAt <= startAt) {
        return { step: 'schedule', errorKey: 'errors.scheduleStopAfterStart' }
      }
    }
  }

  return null
}
