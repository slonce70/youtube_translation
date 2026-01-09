'use client'

import { useCallback, useMemo, useState } from 'react'
import type { TranslationValues } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import type {
  Asset,
  LoopMode,
  MediaCollection,
  Stream,
  StreamLiveUpdatePayload,
} from '@/lib/types'

import {
  deriveEditorStateFromCollection,
  type CollectionEditorItem,
  type CollectionEditorState,
} from '../builder-helpers'
import { useDashboardContext } from '@/app/dashboard/dashboard-context'

type Translator = (key: string, values?: TranslationValues) => string

type UseLiveEditorOptions = {
  assets?: Asset[]
  tStreaming: Translator
  streamingToasts: Translator
}

type LiveEditorState = {
  video: CollectionEditorState | null
  audio: CollectionEditorState | null
}

const getLoopModeForEditor = (editor: CollectionEditorState): LoopMode => {
  if (editor.shuffle) return 'shuffle'
  if (editor.loop) return 'loop'
  return 'once'
}

export const useLiveEditor = ({ assets, tStreaming, streamingToasts }: UseLiveEditorOptions) => {
  const queryClient = useQueryClient()
  const { user } = useDashboardContext()

  const [liveEditingStream, setLiveEditingStream] = useState<Stream | null>(null)
  const [liveEditorState, setLiveEditorState] = useState<LiveEditorState>({
    video: null,
    audio: null,
  })
  const [liveEditorLoading, setLiveEditorLoading] = useState(false)
  const [liveEditorQueueing, setLiveEditorQueueing] = useState<{ video: string | null; audio: string | null }>({
    video: null,
    audio: null,
  })
  const [liveEditorApplying, setLiveEditorApplying] = useState(false)

  const assetMap = useMemo(() => {
    const map = new Map<string, Asset>()
    
    // Add assets from global list
    if (assets) {
      assets.forEach((asset) => map.set(asset.id, asset))
    }
    
    // Add assets from loaded collections
    if (liveEditorState.video?.items) {
      liveEditorState.video.items.forEach((item) => {
        const itemWithAsset = item as CollectionEditorItem & { asset?: Asset }
        if (itemWithAsset.asset) {
          map.set(itemWithAsset.asset.id, itemWithAsset.asset)
        }
      })
    }
    
    if (liveEditorState.audio?.items) {
      liveEditorState.audio.items.forEach((item) => {
        const itemWithAsset = item as CollectionEditorItem & { asset?: Asset }
        if (itemWithAsset.asset) {
          map.set(itemWithAsset.asset.id, itemWithAsset.asset)
        }
      })
    }
    
    return map
  }, [assets, liveEditorState])

  const videoAssets = useMemo(() => (assets ?? []).filter((asset) => asset.asset_type === 'video'), [assets])
  const audioAssets = useMemo(() => (assets ?? []).filter((asset) => asset.asset_type === 'audio'), [assets])

  const canApplyLiveEditorChanges = useMemo(() => {
    const videoOk = !liveEditorState.video || liveEditorState.video.items.length > 0
    const audioOk = !liveEditorState.audio || liveEditorState.audio.items.length > 0
    return videoOk && audioOk
  }, [liveEditorState])

  const resetLiveEditor = useCallback(() => {
    setLiveEditingStream(null)
    setLiveEditorState({ video: null, audio: null })
    setLiveEditorLoading(false)
    setLiveEditorQueueing({ video: null, audio: null })
    setLiveEditorApplying(false)
  }, [])

  const updateEditorState = useCallback(
    (target: 'video' | 'audio', updater: (prev: CollectionEditorState) => CollectionEditorState) => {
      setLiveEditorState((prev) => {
        const current = prev[target]
        if (!current) {
          return prev
        }
        return {
          ...prev,
          [target]: updater(current),
        }
      })
    },
    [],
  )

  const openLiveEditor = useCallback(async (stream: Stream) => {
    setLiveEditingStream(stream)
    setLiveEditorLoading(true)
    setLiveEditorState({ video: null, audio: null })

    try {
      const [videoCollection, audioCollection]: [MediaCollection | null, MediaCollection | null] = await Promise.all([
        stream.video_collection_id ? api.mediaCollections.get(stream.video_collection_id, true) : Promise.resolve(null),
        stream.audio_collection_id ? api.mediaCollections.get(stream.audio_collection_id, true) : Promise.resolve(null),
      ])

      setLiveEditorState({
        video: videoCollection ? deriveEditorStateFromCollection(videoCollection) : null,
        audio: audioCollection ? deriveEditorStateFromCollection(audioCollection) : null,
      })
      setLiveEditorQueueing({ video: null, audio: null })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : streamingToasts('errors.loadCollectionsFailed')
      toast.error(streamingToasts('generic.errorWithMessage', { message }))
      resetLiveEditor()
    } finally {
      setLiveEditorLoading(false)
    }
  }, [resetLiveEditor, streamingToasts])

  const addAssetToLiveEditor = useCallback(
    async (target: 'video' | 'audio', assetId: string) => {
      const editor = liveEditorState[target]
      if (!editor) {
        return
      }

      const appendToState = () => {
        updateEditorState(target, (prev) => {
          if (prev.items.some((item) => item.asset_id === assetId)) {
            return prev
          }
          return {
            ...prev,
            items: [...prev.items, { asset_id: assetId }],
          }
        })
      }

      if (liveEditingStream?.status === 'running') {
        if (editor.items.some((item) => item.asset_id === assetId)) {
          return
        }

        setLiveEditorQueueing((prev) => ({ ...prev, [target]: assetId }))
        try {
          await api.streams.enqueue(liveEditingStream.id, {
            target,
            asset_id: assetId,
            loop_mode: getLoopModeForEditor(editor),
          })
          appendToState()
          const assetName = assetMap.get(assetId)?.filename?.trim()
          if (assetName) {
            toast.success(streamingToasts('stream.enqueuedNamed', { name: assetName }))
          } else {
            toast.success(streamingToasts('stream.enqueued'))
          }
          queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : streamingToasts('errors.enqueueAssetFailed')
          toast.error(streamingToasts('generic.errorWithMessage', { message }))
        } finally {
          setLiveEditorQueueing((prev) => ({ ...prev, [target]: null }))
        }
        return
      }

      appendToState()
    },
    [assetMap, liveEditingStream, liveEditorState, queryClient, streamingToasts, updateEditorState, user?.id],
  )

  const removeLiveEditorItem = useCallback((target: 'video' | 'audio', index: number) => {
    updateEditorState(target, (prev) => ({
      ...prev,
      items: prev.items.filter((_, itemIndex) => itemIndex !== index),
    }))
  }, [updateEditorState])

  const moveLiveEditorItem = useCallback((target: 'video' | 'audio', from: number, to: number) => {
    updateEditorState(target, (prev) => {
      if (to < 0 || to >= prev.items.length) {
        return prev
      }
      const updated = [...prev.items]
      const [removed] = updated.splice(from, 1)
      updated.splice(to, 0, removed)
      return {
        ...prev,
        items: updated,
      }
    })
  }, [updateEditorState])

  const toggleLiveEditorOption = useCallback(
    (target: 'video' | 'audio', option: 'loop' | 'shuffle') => {
      updateEditorState(target, (prev) => ({
        ...prev,
        [option]: !prev[option],
      }))
    },
    [updateEditorState],
  )

  const applyLiveEditorChanges = useCallback(async () => {
    if (!liveEditingStream) return

    const targets: Array<{ target: 'video' | 'audio'; editor: CollectionEditorState }> = []

    if (liveEditorState.video) {
      if (liveEditorState.video.items.length === 0) {
        toast.error(streamingToasts('generic.errorWithMessage', { message: tStreaming('streams.liveEdit.errors.videoEmpty') }))
        return
      }
      targets.push({ target: 'video', editor: liveEditorState.video })
    }

    if (liveEditorState.audio) {
      if (liveEditorState.audio.items.length === 0) {
        toast.error(streamingToasts('generic.errorWithMessage', { message: tStreaming('streams.liveEdit.errors.audioEmpty') }))
        return
      }
      targets.push({ target: 'audio', editor: liveEditorState.audio })
    }

    if (targets.length === 0) {
      toast.error(streamingToasts('generic.errorWithMessage', { message: tStreaming('streams.liveEdit.empty') }))
      return
    }

    setLiveEditorApplying(true)
    try {
      for (const { target, editor } of targets) {
        const payload: StreamLiveUpdatePayload = {
          target,
          restart: false,
          items: editor.items.map((item, index) => ({
            asset_id: item.asset_id,
            position: index,
            loop_mode: getLoopModeForEditor(editor),
          })),
        }

        await api.streams.liveUpdate(liveEditingStream.id, payload)
      }

      toast.success(streamingToasts('stream.liveEdited'))
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : streamingToasts('errors.updateStreamFailed')
      toast.error(streamingToasts('generic.errorWithMessage', { message }))
    } finally {
      setLiveEditorApplying(false)
    }
  }, [liveEditingStream, liveEditorState, queryClient, streamingToasts, tStreaming, user?.id])

  return {
    liveEditingStream,
    liveEditorState,
    liveEditorLoading,
    liveEditorQueueing,
    liveEditorApplying,
    canApplyLiveEditorChanges,
    assetMap,
    videoAssets,
    audioAssets,
    openLiveEditor,
    closeLiveEditor: resetLiveEditor,
    addAssetToLiveEditor,
    removeLiveEditorItem,
    moveLiveEditorItem,
    toggleLiveEditorOption,
    applyLiveEditorChanges,
  }
}
