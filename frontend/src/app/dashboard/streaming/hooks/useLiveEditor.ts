'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import type {
  Asset,
  MediaCollection,
  Stream,
  StreamLiveUpdatePayload,
} from '@/lib/types'

import { deriveEditorStateFromCollection, type CollectionEditorState } from '../builder-helpers'

type Translator = (key: string, values?: Record<string, unknown>) => string

type UseLiveEditorOptions = {
  assets?: Asset[]
  tStreaming: Translator
  streamingToasts: Translator
}

type LiveEditorState = {
  video: CollectionEditorState | null
  audio: CollectionEditorState | null
}

const getLoopModeForEditor = (editor: CollectionEditorState) => {
  if (editor.shuffle) return 'shuffle'
  if (editor.loop) return 'loop'
  return 'once'
}

export const useLiveEditor = ({ assets, tStreaming, streamingToasts }: UseLiveEditorOptions) => {
  const queryClient = useQueryClient()

  const [liveEditingStream, setLiveEditingStream] = useState<Stream | null>(null)
  const [liveEditorState, setLiveEditorState] = useState<LiveEditorState>({
    video: null,
    audio: null,
  })
  const [liveEditorLoading, setLiveEditorLoading] = useState(false)
  const [liveEditorSaving, setLiveEditorSaving] = useState<{ video: boolean; audio: boolean }>({
    video: false,
    audio: false,
  })

  const assetMap = useMemo(() => {
    if (!assets) return new Map<string, Asset>()
    return new Map(assets.map((asset) => [asset.id, asset]))
  }, [assets])

  const videoAssets = useMemo(() => (assets ?? []).filter((asset) => asset.asset_type === 'video'), [assets])
  const audioAssets = useMemo(() => (assets ?? []).filter((asset) => asset.asset_type === 'audio'), [assets])

  const resetLiveEditor = useCallback(() => {
    setLiveEditingStream(null)
    setLiveEditorState({ video: null, audio: null })
    setLiveEditorLoading(false)
    setLiveEditorSaving({ video: false, audio: false })
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load collections'
      toast.error(streamingToasts('generic.errorWithMessage', { message }))
      resetLiveEditor()
    } finally {
      setLiveEditorLoading(false)
    }
  }, [resetLiveEditor, streamingToasts])

  const addAssetToLiveEditor = useCallback((target: 'video' | 'audio', assetId: string) => {
    updateEditorState(target, (prev) => {
      if (prev.items.some((item) => item.asset_id === assetId)) {
        return prev
      }
      return {
        ...prev,
        items: [...prev.items, { asset_id: assetId }],
      }
    })
  }, [updateEditorState])

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

  const liveEditorHasSelection = useCallback(
    (target: 'video' | 'audio') => Boolean(liveEditorState[target]?.items.length),
    [liveEditorState],
  )

  const saveLiveEditorChanges = useCallback(
    async (target: 'video' | 'audio') => {
      if (!liveEditingStream) return
      const editor = liveEditorState[target]
      if (!editor || editor.items.length === 0) {
        toast.error(streamingToasts('generic.errorWithMessage', { message: tStreaming('streams.liveEdit.empty') }))
        return
      }

      const payload: StreamLiveUpdatePayload = {
        target,
        restart: liveEditingStream.status === 'running',
        items: editor.items.map((item, index) => ({
          asset_id: item.asset_id,
          position: index,
          loop_mode: getLoopModeForEditor(editor),
        })),
      }

      setLiveEditorSaving((prev) => ({ ...prev, [target]: true }))
      try {
        await api.streams.liveUpdate(liveEditingStream.id, payload)
        toast.success(streamingToasts('stream.liveEdited'))
        queryClient.invalidateQueries({ queryKey: ['streams'] })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update stream'
        toast.error(streamingToasts('generic.errorWithMessage', { message }))
      } finally {
        setLiveEditorSaving((prev) => ({ ...prev, [target]: false }))
      }
    },
    [liveEditingStream, liveEditorState, queryClient, streamingToasts, tStreaming],
  )

  return {
    liveEditingStream,
    liveEditorState,
    liveEditorLoading,
    liveEditorSaving,
    assetMap,
    videoAssets,
    audioAssets,
    openLiveEditor,
    closeLiveEditor: resetLiveEditor,
    addAssetToLiveEditor,
    removeLiveEditorItem,
    moveLiveEditorItem,
    toggleLiveEditorOption,
    liveEditorHasSelection,
    saveLiveEditorChanges,
  }
}
