import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import type { TranslationValues } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import type {
  Asset,
  CreateStreamPayload,
  Destination,
  LoopMode,
  MediaCollection,
  QuotaUsageResponse,
  Stream,
} from '@/lib/types'

import {
  BUILDER_STEPS,
  customizeEditorState,
  createDefaultEditorState,
  DEFAULT_MIX_MODE,
  DEFAULT_SCHEDULE_STATE,
  deriveEditorStateFromCollection,
  hasEditorSelection,
  type BuilderStep,
  type CollectionEditorState,
  type ScheduleState,
  validateBuilderState,
} from '../builder-helpers'
import { useDashboardContext } from '@/app/dashboard/dashboard-context'

type Translator = (key: string, values?: TranslationValues) => string

export type BuilderTab = BuilderStep

export type StreamFormState = {
  name: string
  destination_ids: string[]
}

type DragState = { collection: 'video' | 'audio'; index: number } | null

type UseStreamBuilderOptions = {
  destinations?: Destination[]
  assets?: Asset[]
  videoCollections?: MediaCollection[]
  audioCollections?: MediaCollection[]
  streams?: Stream[]
  quota?: QuotaUsageResponse
  tStreaming: Translator
  streamingToasts: Translator
  onCreated?: () => void
}

export const useStreamBuilder = ({
  destinations,
  assets,
  videoCollections,
  audioCollections,
  streams,
  quota,
  tStreaming,
  streamingToasts,
  onCreated,
}: UseStreamBuilderOptions) => {
  const queryClient = useQueryClient()
  const { user } = useDashboardContext()

  const enabledDestinations = useMemo(
    () => (destinations ?? []).filter((destination) => destination.enabled),
    [destinations],
  )

  const [streamForm, setStreamForm] = useState<StreamFormState>(() => ({
    name: '',
    destination_ids: enabledDestinations.length > 0 ? [enabledDestinations[0].id] : [],
  }))
  const [activeBuilderTab, setActiveBuilderTab] = useState<BuilderTab>('content')
  const [mixMode, setMixMode] = useState<'video_only' | 'mixed'>(DEFAULT_MIX_MODE)
  const [videoEditor, setVideoEditor] = useState<CollectionEditorState>(createDefaultEditorState())
  const [audioEditor, setAudioEditor] = useState<CollectionEditorState>(
    createDefaultEditorState({ shuffle: true }),
  )
  const [scheduleState, setScheduleState] = useState<ScheduleState>(DEFAULT_SCHEDULE_STATE)
  const [dragState, setDragState] = useState<DragState>(null)
  const [isBuilderSubmitting, setIsBuilderSubmitting] = useState(false)

  const assetMap = useMemo(() => {
    if (!assets) return new Map<string, Asset>()
    return new Map(assets.map((asset) => [asset.id, asset]))
  }, [assets])

  const videoAssets = useMemo(
    () => (assets ?? []).filter((asset) => asset.asset_type === 'video'),
    [assets],
  )
  const audioAssets = useMemo(
    () => (assets ?? []).filter((asset) => asset.asset_type === 'audio'),
    [assets],
  )

  const runningStreams = useMemo(
    () => (streams ?? []).filter((stream) => stream.status === 'running'),
    [streams],
  )
  const errorStreams = useMemo(
    () => (streams ?? []).filter((stream) => stream.status === 'error'),
    [streams],
  )

  const concurrentStreamsLimit = quota?.streams?.limit ?? null
  const planQualityLimits = quota?.quality

  const builderTabsList: BuilderTab[] = useMemo(() => [...BUILDER_STEPS], [])
  const currentTabIndex = builderTabsList.indexOf(activeBuilderTab)
  const isFinalTab = currentTabIndex === builderTabsList.length - 1

  const audioEnabled = mixMode === 'mixed'

  useEffect(() => {
    if (enabledDestinations.length === 0) {
      return
    }

    setStreamForm((prev) => {
      if (prev.destination_ids.length > 0) {
        return prev
      }
      return { ...prev, destination_ids: [enabledDestinations[0].id] }
    })
  }, [enabledDestinations])

  const updateEditor = useCallback(
    (
      target: 'video' | 'audio',
      updater: (current: CollectionEditorState) => CollectionEditorState,
    ) => {
      if (target === 'video') {
        setVideoEditor((prev) => updater(prev))
      } else {
        setAudioEditor((prev) => updater(prev))
      }
    },
    [],
  )

  const addAssetToEditor = useCallback(
    (target: 'video' | 'audio', assetId: string) => {
      updateEditor(target, (prev) => {
        if (prev.items.some((item) => item.asset_id === assetId)) {
          return prev
        }
        return customizeEditorState(prev, {
          items: [...prev.items, { asset_id: assetId }],
        })
      })
    },
    [updateEditor],
  )

  const removeAssetFromEditor = useCallback(
    (target: 'video' | 'audio', assetId: string) => {
      updateEditor(target, (prev) => customizeEditorState(prev, {
        items: prev.items.filter((item) => item.asset_id !== assetId),
      }))
    },
    [updateEditor],
  )

  const reorderEditorItems = useCallback(
    (target: 'video' | 'audio', fromIndex: number, toIndex: number) => {
      updateEditor(target, (prev) => {
        if (fromIndex === toIndex) return prev
        const items = [...prev.items]
        const [moved] = items.splice(fromIndex, 1)
        items.splice(Math.max(0, Math.min(items.length, toIndex)), 0, moved)
        return customizeEditorState(prev, { items })
      })
    },
    [updateEditor],
  )

  const handleItemDragStart = useCallback(
    (target: 'video' | 'audio', index: number, event: DragEvent<HTMLElement>) => {
      setDragState({ collection: target, index })
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-collection-index', String(index))
      }
    },
    [],
  )

  const handleItemDrop = useCallback(
    (target: 'video' | 'audio', index: number, event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      const payload = event.dataTransfer?.getData('application/x-collection-index')
      const fromIndex = payload !== undefined && payload !== '' ? Number(payload) : dragState?.index
      if (Number.isNaN(fromIndex) || fromIndex === undefined) {
        setDragState(null)
        return
      }

      reorderEditorItems(target, fromIndex, index)
      setDragState(null)
    },
    [dragState?.index, reorderEditorItems],
  )

  const handleSelectCollection = useCallback(
    (target: 'video' | 'audio', collectionId: string | 'custom') => {
      if (collectionId === 'custom') {
        updateEditor(target, (prev) => ({
          ...createDefaultEditorState({ shuffle: target === 'audio' }),
          mode: 'custom',
          name: prev.name,
          items: prev.items,
        }))
        return
      }

      const sourceCollections = target === 'video' ? videoCollections : audioCollections
      const found = sourceCollections?.find((collection) => collection.id === collectionId)
      if (found) {
        const derived = deriveEditorStateFromCollection(found)
        updateEditor(target, () => derived)
        if (target === 'audio') {
          setMixMode('mixed')
        }
      }
    },
    [audioCollections, updateEditor, videoCollections],
  )

  const handleCustomizeExisting = useCallback((target: 'video' | 'audio') => {
    updateEditor(target, (prev) => customizeEditorState(prev))
  }, [updateEditor])

  const handleDestinationToggle = useCallback((destinationId: string) => {
    setStreamForm((prev) =>
      prev.destination_ids.includes(destinationId)
        ? {
            ...prev,
            destination_ids: prev.destination_ids.filter((id) => id !== destinationId),
          }
        : {
            ...prev,
            destination_ids: [...prev.destination_ids, destinationId],
          },
    )
  }, [])

  const loopModeForEditor = useCallback((editor: CollectionEditorState): LoopMode => {
    if (editor.shuffle) return 'shuffle'
    if (editor.loop) return 'loop'
    return 'once'
  }, [])

  const persistEditorAsCollection = useCallback(
    async (
      editor: CollectionEditorState,
      type: 'video_background' | 'audio_playlist',
      fallbackLabel: string,
    ): Promise<string> => {
      const payload = {
        name: editor.name.trim() || `${fallbackLabel} ${new Date().toLocaleTimeString()}`,
        collection_type: type,
        items: editor.items.map((item, index) => ({
          asset_id: item.asset_id,
          position: index,
          loop_mode: loopModeForEditor(editor),
        })),
      }
      const created = await api.mediaCollections.create(payload)
      return created.id
    },
    [loopModeForEditor],
  )

  const handleAudioToggle = useCallback((enabled: boolean) => {
    if (enabled) {
      setMixMode('mixed')
    } else {
      setMixMode('video_only')
      setAudioEditor(createDefaultEditorState({ shuffle: true }))
    }
  }, [])

  const resetBuilderState = useCallback(() => {
    setStreamForm({
      name: '',
      destination_ids: enabledDestinations.length > 0 ? [enabledDestinations[0].id] : [],
    })
    setVideoEditor(createDefaultEditorState())
    setAudioEditor(createDefaultEditorState({ shuffle: true }))
    setScheduleState(DEFAULT_SCHEDULE_STATE)
    setMixMode(DEFAULT_MIX_MODE)
    setDragState(null)
    setActiveBuilderTab('content')
  }, [enabledDestinations])

  const createStreamMutation = useMutation({
    mutationFn: (payload: CreateStreamPayload) => api.streams.create(payload),
    onSuccess: () => {
      toast.success(streamingToasts('stream.created'))
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
      resetBuilderState()
      onCreated?.()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const handleBuilderSubmit = useCallback(async () => {
    const validation = validateBuilderState({
      hasVideoSelection: hasEditorSelection(videoEditor),
      audioEnabled,
      hasAudioSelection: hasEditorSelection(audioEditor),
      selectedDestinationCount: streamForm.destination_ids.length,
      scheduleState,
    })

    if (validation) {
      toast.error(streamingToasts(validation.errorKey))
      setActiveBuilderTab(validation.step)
      return
    }

    const startAtIso =
      scheduleState.startMode === 'schedule' && scheduleState.startAt
        ? new Date(scheduleState.startAt).toISOString()
        : undefined
    const stopAtIso = scheduleState.stopAt ? new Date(scheduleState.stopAt).toISOString() : undefined

    const createdCollectionTracker = {
      video: null as string | null,
      audio: null as string | null,
    }
    let createRequestFailed = false

    setIsBuilderSubmitting(true)
    try {
      let videoCollectionId = videoEditor.selectedCollectionId
      if (!videoCollectionId || videoEditor.mode === 'custom') {
        createdCollectionTracker.video = await persistEditorAsCollection(
          videoEditor,
          'video_background',
          tStreaming('streams.builder.video.title'),
        )
        videoCollectionId = createdCollectionTracker.video
      }

      let audioCollectionId: string | undefined
      if (audioEnabled) {
        audioCollectionId = audioEditor.selectedCollectionId ?? undefined
        if (!audioCollectionId || audioEditor.mode === 'custom') {
          createdCollectionTracker.audio = await persistEditorAsCollection(
            audioEditor,
            'audio_playlist',
            tStreaming('streams.builder.audio.title'),
          )
          audioCollectionId = createdCollectionTracker.audio
        }
      }

      const payload: CreateStreamPayload = {
        name: streamForm.name || undefined,
        destination_ids: streamForm.destination_ids,
        video_collection_id: videoCollectionId ?? undefined,
        audio_collection_id: audioEnabled ? audioCollectionId : undefined,
        mix_mode: audioEnabled ? 'mixed' : 'video_only',
        settings_json: {
          loop_stream: scheduleState.loopStream,
          video_volume: scheduleState.videoVolume,
          audio_volume: scheduleState.audioVolume,
          shuffle_video: videoEditor.shuffle,
          shuffle_audio: audioEditor.shuffle,
        },
        schedule_mode: scheduleState.startMode,
        schedule_start_at: startAtIso,
        schedule_stop_at: stopAtIso,
      }

      try {
        await createStreamMutation.mutateAsync(payload)
      } catch (error) {
        createRequestFailed = true
        throw error
      }
    } catch (error) {
      if (!createRequestFailed) {
        const message =
          error instanceof Error ? error.message : streamingToasts('errors.createStreamFailed')
        toast.error(streamingToasts('generic.errorWithMessage', { message }))
      }

      const createdCollectionIds = [createdCollectionTracker.video, createdCollectionTracker.audio].filter(
        (id): id is string => Boolean(id),
      )
      if (createdCollectionIds.length > 0) {
        await Promise.allSettled(createdCollectionIds.map((id) => api.mediaCollections.delete(id)))
        queryClient.invalidateQueries({ queryKey: ['media-collections', user?.id] })
      }
    } finally {
      setIsBuilderSubmitting(false)
    }
  }, [
    audioEditor,
    audioEnabled,
    persistEditorAsCollection,
    queryClient,
    scheduleState,
    streamForm,
    streamingToasts,
    tStreaming,
    user?.id,
    videoEditor,
    createStreamMutation,
  ])

  return {
    streamForm,
    setStreamForm,
    activeBuilderTab,
    setActiveBuilderTab,
    builderTabsList,
    currentTabIndex,
    isFinalTab,
    mixMode,
    audioEnabled,
    videoEditor,
    audioEditor,
    scheduleState,
    setScheduleState,
    addAssetToEditor,
    removeAssetFromEditor,
    handleItemDragStart,
    handleItemDrop,
    handleSelectCollection,
    handleCustomizeExisting,
    handleDestinationToggle,
    handleAudioToggle,
    handleBuilderSubmit,
    isBuilderSubmitting,
    createPending: createStreamMutation.isPending,
    videoAssets,
    audioAssets,
    assetMap,
    destinations,
    enabledDestinations,
    dragState,
    resetBuilderState,
    runningStreams,
    errorStreams,
    concurrentStreamsLimit,
    planQualityLimits,
    updateEditor,
    reorderEditorItems,
  }
}
