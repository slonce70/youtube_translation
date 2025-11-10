'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import type { Locale as DateFnsLocale } from 'date-fns'
import { enUS, ru, uk as ukLocale } from 'date-fns/locale'
import {
  Radio,
  Play,
  Square,
  Trash2,
  Plus,
  Loader2,
  Activity,
  X,
  TvMinimal,
  Edit,
  Layers,
  Music3,
  MapPin,
  Clock3,
  Shuffle,
  Repeat,
  GripVertical,
  Info,
  AlertTriangle,
  Volume2,
  VolumeX,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'

import { api } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { cn } from '@/lib/utils'
import type {
  Playlist,
  Destination,
  DestinationUpdatePayload,
  Asset,
  Stream,
  StreamLogsResponse,
  CreateStreamPayload,
  StreamStatusValue,
  StreamStatusResponse,
  StreamQualityResponse,
  SubscriptionTierKey,
  MediaCollection,
  LoopMode,
  StreamLiveUpdatePayload,
} from '@/lib/types'
import { useDashboardContext } from '../dashboard-context'
import {
  createDefaultEditorState,
  DEFAULT_SCHEDULE_STATE,
  deriveEditorStateFromCollection,
  type CollectionEditorItem,
  type CollectionEditorState,
  type ScheduleState,
} from './builder-helpers'

type StreamFormState = {
  name: string
  destination_ids: string[]
}

type BuilderTab = 'video' | 'audio' | 'destinations' | 'schedule'

type DestinationFormState = {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
}


type QualityViolation = StreamQualityResponse['violations'][number]

type GroupedQualityViolation = {
  assetKey: string
  filename: string | null
  position: number
  issues: Array<{
    violation: QualityViolation
    details: string[]
  }>
}

const statusVariantMap: Record<StreamStatusValue, 'success' | 'info' | 'warning' | 'error'> = {
  running: 'success',
  stopped: 'info',
  starting: 'warning',
  stopping: 'warning',
  error: 'error',
}

const dateLocales: Record<string, DateFnsLocale> = {
  en: enUS,
  ru,
  uk: ukLocale,
}

export default function StreamingPage() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { user, quota, quotaLoading, currentTier } = useDashboardContext()
  const planNames = useTranslations('dashboard.quota.tiers')
  const activePlanLabel = planNames((currentTier ?? 'free') as SubscriptionTierKey)
  const streamingToasts = useTranslations('streaming.toasts')
  const streamingStatus = useTranslations('streaming.status')
  const tStreaming = useTranslations('streaming.page')
  const locale = useLocale()
  const dateLocale = dateLocales[locale] ?? enUS

  const violationTranslationKey: Record<string, string> = {
    resolution_exceeded: 'streams.quality.violations.resolution',
    fps_exceeded: 'streams.quality.violations.fps',
    fps_out_of_range: 'streams.quality.violations.fpsRange',
    bitrate_out_of_range: 'streams.quality.violations.bitrateRange',
    bitrate_missing: 'streams.quality.violations.bitrateMissing',
    guideline_missing: 'streams.quality.violations.guidelineMissing',
    missing_metadata: 'streams.quality.violations.missingMetadata',
  }

  const [qualityGate, setQualityGate] = useState<{
    streamName?: string | null
    quality: StreamQualityResponse
  } | null>(null)

  const groupedQualityViolations = useMemo<GroupedQualityViolation[]>(() => {
    if (!qualityGate?.quality?.violations?.length) {
      return []
    }

    const groups = new Map<
      string,
      {
        assetKey: string
        filename: string | null
        position: number
        issues: Map<
          string,
          {
            violation: QualityViolation
            details: string[]
          }
        >
      }
    >()

    qualityGate.quality.violations.forEach((violation, index) => {
      const assetKey =
        violation.asset_id ??
        violation.filename ??
        (typeof violation.position === 'number'
          ? `position-${violation.position}`
          : `index-${index}`)

      if (!groups.has(assetKey)) {
        groups.set(assetKey, {
          assetKey,
          filename: violation.filename ?? null,
          position: typeof violation.position === 'number' ? violation.position : index,
          issues: new Map(),
        })
      }

      const group = groups.get(assetKey)!

      if (typeof violation.position === 'number' && violation.position < group.position) {
        group.position = violation.position
      }
      const issueKey = violation.code ?? `code-${group.issues.size}`
      const existingIssue = group.issues.get(issueKey)

      if (!existingIssue) {
        group.issues.set(issueKey, {
          violation,
          details: violation.message ? [violation.message] : [],
        })
        return
      }

      const existingHasContext =
        existingIssue.violation.allowed != null || existingIssue.violation.current != null
      const newHasContext = violation.allowed != null || violation.current != null

      if (!existingHasContext && newHasContext) {
        existingIssue.violation = { ...violation }
      }

      if (violation.message && !existingIssue.details.includes(violation.message)) {
        existingIssue.details.push(violation.message)
      }
    })

    return Array.from(groups.values())
      .map(({ issues, ...rest }) => ({
        ...rest,
        issues: Array.from(issues.values()),
      }))
      .sort((a, b) => a.position - b.position)
  }, [qualityGate?.quality?.violations])

  // Channels (Destinations) state
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [channelForm, setChannelForm] = useState<DestinationFormState>({
    name: '',
    rtmps_url: 'rtmps://a.rtmp.youtube.com/live2',
    stream_key: '',
    enabled: true,
  })

  // Streams state
  const [viewingLogs, setViewingLogs] = useState<string | null>(null)
  const [showCreateStream, setShowCreateStream] = useState(false)
  const [streamForm, setStreamForm] = useState<StreamFormState>({
    name: '',
    destination_ids: [],
  })
  const [activeBuilderTab, setActiveBuilderTab] = useState<BuilderTab>('video')
  const [mixMode, setMixMode] = useState<'video_only' | 'mixed'>('mixed')
  const [videoEditor, setVideoEditor] = useState<CollectionEditorState>(createDefaultEditorState())
  const [audioEditor, setAudioEditor] = useState<CollectionEditorState>(
    createDefaultEditorState({ shuffle: true })
  )
  const [scheduleState, setScheduleState] = useState<ScheduleState>(DEFAULT_SCHEDULE_STATE)
  const [dragState, setDragState] = useState<{ collection: 'video' | 'audio'; index: number } | null>(
    null
  )
  const [isBuilderSubmitting, setIsBuilderSubmitting] = useState(false)
  const [liveEditingStream, setLiveEditingStream] = useState<Stream | null>(null)
  const [liveEditorState, setLiveEditorState] = useState<{
    video: CollectionEditorState | null
    audio: CollectionEditorState | null
  }>({ video: null, audio: null })
  const [liveEditorLoading, setLiveEditorLoading] = useState(false)
  const [liveEditorSaving, setLiveEditorSaving] = useState<{ video: boolean; audio: boolean }>({
    video: false,
    audio: false,
  })

  // API Queries
  const { data: destinations, isLoading: isLoadingDestinations } = useQuery<Destination[]>({
    queryKey: ['destinations'],
    queryFn: () => api.destinations.list(),
    enabled: !!user,
  })

  const { data: streams, isLoading: isLoadingStreams } = useQuery<Stream[]>({
    queryKey: ['streams'],
    queryFn: () => api.streams.list(),
    enabled: !!user,
    refetchInterval: 3000,
  })

  const { data: playlists } = useQuery<Playlist[]>({
    queryKey: ['playlists'],
    queryFn: () => api.playlists.list(),
    enabled: !!user,
  })

  const { data: assets, isLoading: isLoadingAssets } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: () => api.assets.list(),
    enabled: !!user,
  })

  const { data: videoCollections, isLoading: isLoadingVideoCollections } = useQuery<MediaCollection[]>({
    queryKey: ['media-collections', 'video'],
    queryFn: () =>
      api.mediaCollections.list({
        collection_type: 'video_background',
        include_items: true,
      }),
    enabled: !!user && showCreateStream,
  })

  const { data: audioCollections, isLoading: isLoadingAudioCollections } = useQuery<MediaCollection[]>({
    queryKey: ['media-collections', 'audio'],
    queryFn: () =>
      api.mediaCollections.list({
        collection_type: 'audio_playlist',
        include_items: true,
      }),
    enabled: !!user && showCreateStream,
  })

  const { data: logsResponse } = useQuery<StreamLogsResponse>({
    queryKey: ['stream-logs', viewingLogs],
    queryFn: () => api.streams.logs(viewingLogs!, 200),
    enabled: !!viewingLogs,
    refetchInterval: 2000,
  })

  const playlistMap = useMemo(() => {
    if (!playlists) return new Map<string, Playlist>()
    return new Map(playlists.map((playlist) => [playlist.id, playlist]))
  }, [playlists])

  const assetMap = useMemo(() => {
    if (!assets) return new Map<string, Asset>()
    return new Map(assets.map((asset) => [asset.id, asset]))
  }, [assets])

  const videoAssets = useMemo(() => (assets ?? []).filter((asset) => asset.asset_type === 'video'), [assets])
  const audioAssets = useMemo(() => (assets ?? []).filter((asset) => asset.asset_type === 'audio'), [assets])

  const enabledDestinations = useMemo(
    () => (destinations || []).filter((destination) => destination.enabled),
    [destinations]
  )

  const builderTabsList: BuilderTab[] = ['video', 'audio', 'destinations', 'schedule']
  const currentTabIndex = builderTabsList.indexOf(activeBuilderTab)
  const isFinalTab = currentTabIndex === builderTabsList.length - 1

  const runningStreams = useMemo(() => (streams ?? []).filter((stream) => stream.status === 'running'), [streams])
  const errorStreams = useMemo(() => (streams ?? []).filter((stream) => stream.status === 'error'), [streams])

  const formatLimitValue = (value?: number | null) => (value == null ? '∞' : value.toString())
  const destinationsLimit = quota?.destinations?.limit ?? null
  const concurrentStreamsLimit = quota?.streams?.limit ?? null
  const planQualityLimits = quota?.quality

  useEffect(() => {
    if (enabledDestinations.length > 0 && streamForm.destination_ids.length === 0) {
      setStreamForm((prev) => ({ ...prev, destination_ids: [enabledDestinations[0].id] }))
    }
  }, [enabledDestinations, streamForm.destination_ids.length])

  // Destination Mutations
  const createDestinationMutation = useMutation({
    mutationFn: (data: DestinationFormState) => api.destinations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations'] })
      toast.success(streamingToasts('destination.created'))
      resetChannelForm()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const updateDestinationMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DestinationFormState }) => {
      const payload: DestinationUpdatePayload = {
        name: data.name,
        rtmps_url: data.rtmps_url,
        enabled: data.enabled,
      }
      if (data.stream_key.trim()) {
        payload.stream_key = data.stream_key.trim()
      }
      return api.destinations.update(id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations'] })
      toast.success(streamingToasts('destination.updated'))
      resetChannelForm()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const deleteDestinationMutation = useMutation({
    mutationFn: (destinationId: string) => api.destinations.delete(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations'] })
      toast.success(streamingToasts('destination.deleted'))
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  // Stream Mutations
  const createStreamMutation = useMutation({
    mutationFn: (payload: CreateStreamPayload) => api.streams.create(payload),
    onSuccess: () => {
      toast.success(streamingToasts('stream.created'))
      queryClient.invalidateQueries({ queryKey: ['streams'] })
      resetStreamForm()
    },
    onError: (error: Error) => {
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  type StartStreamVariables = { streamId: string; streamName?: string | null }

  const startStreamMutation = useMutation<StreamStatusResponse, Error & { quality?: StreamQualityResponse }, StartStreamVariables>({
    mutationFn: async ({ streamId }: StartStreamVariables) => {
      const quality = await api.streams.quality(streamId)
      if (!quality.ok) {
        const error = new Error('quality_rejected') as Error & { quality: StreamQualityResponse }
        error.quality = quality
        throw error
      }
      return api.streams.start(streamId)
    },
    onSuccess: (_, variables) => {
      toast.success(streamingToasts('stream.started'))
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
    onError: (error: Error & { quality?: StreamQualityResponse }, variables) => {
      if (error.quality && !error.quality.ok) {
        setQualityGate({ streamName: variables?.streamName, quality: error.quality })
        return
      }
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const stopStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.stop(streamId),
    onSuccess: () => {
      toast.info(streamingToasts('stream.stopped'))
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const deleteStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.delete(streamId),
    onSuccess: (_, streamId) => {
      toast.success(streamingToasts('stream.deleted'))
      if (viewingLogs === streamId) {
        setViewingLogs(null)
      }
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  // Handlers
  const resetChannelForm = () => {
    setChannelForm({
      name: '',
      rtmps_url: 'rtmps://a.rtmp.youtube.com/live2',
      stream_key: '',
      enabled: true,
    })
    setEditingChannelId(null)
    setShowChannelForm(false)
  }

  const resetStreamForm = () => {
    setStreamForm((prev) => ({
      name: '',
      destination_ids: enabledDestinations.length > 0 ? [enabledDestinations[0].id] : prev.destination_ids,
    }))
    setVideoEditor(createDefaultEditorState())
    setAudioEditor(createDefaultEditorState({ shuffle: true }))
    setScheduleState(DEFAULT_SCHEDULE_STATE)
    setMixMode('mixed')
    setDragState(null)
    setActiveBuilderTab('video')
    setShowCreateStream(false)
  }

  const updateEditor = (
    target: 'video' | 'audio',
    updater: (current: CollectionEditorState) => CollectionEditorState
  ) => {
    if (target === 'video') {
      setVideoEditor((prev) => updater(prev))
    } else {
      setAudioEditor((prev) => updater(prev))
    }
  }

  const addAssetToEditor = (target: 'video' | 'audio', assetId: string) => {
    updateEditor(target, (prev) => {
      if (prev.items.some((item) => item.asset_id === assetId)) {
        return prev
      }
      return {
        ...prev,
        items: [...prev.items, { asset_id: assetId }],
        mode: prev.mode === 'existing' ? 'custom' : prev.mode,
      }
    })
  }

  const removeAssetFromEditor = (target: 'video' | 'audio', assetId: string) => {
    updateEditor(target, (prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.asset_id !== assetId),
    }))
  }

  const reorderEditorItems = (target: 'video' | 'audio', fromIndex: number, toIndex: number) => {
    updateEditor(target, (prev) => {
      if (fromIndex === toIndex) return prev
      const items = [...prev.items]
      const [moved] = items.splice(fromIndex, 1)
      items.splice(Math.max(0, Math.min(items.length, toIndex)), 0, moved)
      return { ...prev, items }
    })
  }

  const handleItemDragStart = (target: 'video' | 'audio', index: number) => {
    setDragState({ collection: target, index })
  }

  const handleItemDrop = (target: 'video' | 'audio', index: number) => {
    if (!dragState || dragState.collection !== target) {
      setDragState(null)
      return
    }
    reorderEditorItems(target, dragState.index, index)
    setDragState(null)
  }

  const handleSelectCollection = (target: 'video' | 'audio', collectionId: string | 'custom') => {
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
  }

  const handleCustomizeExisting = (target: 'video' | 'audio') => {
    updateEditor(target, (prev) => ({
      ...prev,
      mode: 'custom',
      selectedCollectionId: null,
    }))
  }

  const handleDestinationToggle = (destinationId: string) => {
    setStreamForm((prev) =>
      prev.destination_ids.includes(destinationId)
        ? { ...prev, destination_ids: prev.destination_ids.filter((id) => id !== destinationId) }
        : { ...prev, destination_ids: [...prev.destination_ids, destinationId] }
    )
  }

  const editorHasSelection = (editor: CollectionEditorState) =>
    Boolean(editor.selectedCollectionId) || editor.items.length > 0

  const loopModeForEditor = (editor: CollectionEditorState): LoopMode => {
    if (editor.shuffle) return 'shuffle'
    if (editor.loop) return 'loop'
    return 'once'
  }

  const persistEditorAsCollection = async (
    editor: CollectionEditorState,
    type: 'video_background' | 'audio_playlist',
    fallbackLabel: string
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
  }

  const audioEnabled = mixMode === 'mixed'

  const handleAudioToggle = (enabled: boolean) => {
    if (enabled) {
      setMixMode('mixed')
    } else {
      setMixMode('video_only')
      setAudioEditor(createDefaultEditorState({ shuffle: true }))
    }
  }

  const handleBuilderSubmit = async () => {
    const hasVideoSelection = editorHasSelection(videoEditor)
    if (!hasVideoSelection) {
      toast.error(streamingToasts('errors.selectBackground'))
      setActiveBuilderTab('video')
      return
    }

    if (audioEnabled && !editorHasSelection(audioEditor)) {
      toast.error(streamingToasts('errors.selectAudio'))
      setActiveBuilderTab('audio')
      return
    }

    if (streamForm.destination_ids.length === 0) {
      toast.error(streamingToasts('errors.selectDestination'))
      setActiveBuilderTab('destinations')
      return
    }

    if (scheduleState.startMode === 'schedule' && !scheduleState.startAt) {
      toast.error(streamingToasts('errors.scheduleTime'))
      setActiveBuilderTab('schedule')
      return
    }

    setIsBuilderSubmitting(true)
    try {
      let videoCollectionId = videoEditor.selectedCollectionId
      if (!videoCollectionId || videoEditor.mode === 'custom') {
        videoCollectionId = await persistEditorAsCollection(
          videoEditor,
          'video_background',
          tStreaming('streams.builder.video.title')
        )
      }

      let audioCollectionId: string | undefined
      if (audioEnabled) {
          audioCollectionId = audioEditor.selectedCollectionId ?? undefined
          if (!audioCollectionId || audioEditor.mode === 'custom') {
            audioCollectionId = await persistEditorAsCollection(
              audioEditor,
              'audio_playlist',
              tStreaming('streams.builder.audio.title')
            )
          }
      }

      const payload: CreateStreamPayload = {
        name: streamForm.name || undefined,
        destination_ids: streamForm.destination_ids,
        video_collection_id: videoCollectionId ?? undefined,
        audio_collection_id: audioEnabled ? audioCollectionId : undefined,
        mix_mode: audioEnabled ? 'mixed' : 'video_only',
        settings_json: {
          start_mode: scheduleState.startMode,
          start_at: scheduleState.startMode === 'schedule' ? scheduleState.startAt : undefined,
          loop_stream: scheduleState.loopStream,
          video_volume: scheduleState.videoVolume,
          audio_volume: scheduleState.audioVolume,
          shuffle_video: videoEditor.shuffle,
          shuffle_audio: audioEditor.shuffle,
        },
      }

      try {
        await createStreamMutation.mutateAsync(payload)
      } catch (error) {
        // handled by mutation toast
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create collection'
      toast.error(streamingToasts('generic.errorWithMessage', { message }))
    } finally {
      setIsBuilderSubmitting(false)
    }
  }

  const resetLiveEditor = () => {
    setLiveEditingStream(null)
    setLiveEditorState({ video: null, audio: null })
    setLiveEditorLoading(false)
    setLiveEditorSaving({ video: false, audio: false })
  }

  const openLiveEditor = async (stream: Stream) => {
    setLiveEditingStream(stream)
    setLiveEditorLoading(true)
    setLiveEditorState({ video: null, audio: null })
    try {
      const [videoCollection, audioCollection] = await Promise.all([
        stream.video_collection_id ? api.mediaCollections.get(stream.video_collection_id, true) : null,
        stream.audio_collection_id ? api.mediaCollections.get(stream.audio_collection_id, true) : null,
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
  }

  const updateLiveEditorState = (
    target: 'video' | 'audio',
    updater: (prev: CollectionEditorState) => CollectionEditorState
  ) => {
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
  }

  const addAssetToLiveEditor = (target: 'video' | 'audio', assetId: string) => {
    updateLiveEditorState(target, (prev) => {
      if (prev.items.some((item) => item.asset_id === assetId)) {
        return prev
      }
      return {
        ...prev,
        items: [...prev.items, { asset_id: assetId }],
      }
    })
  }

  const removeLiveEditorItem = (target: 'video' | 'audio', index: number) => {
    updateLiveEditorState(target, (prev) => ({
      ...prev,
      items: prev.items.filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  const moveLiveEditorItem = (target: 'video' | 'audio', from: number, to: number) => {
    updateLiveEditorState(target, (prev) => {
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
  }

  const toggleLiveEditorOption = (target: 'video' | 'audio', option: 'loop' | 'shuffle') => {
    updateLiveEditorState(target, (prev) => ({
      ...prev,
      [option]: !prev[option],
    }))
  }

  const liveEditorHasSelection = (target: 'video' | 'audio') =>
    Boolean(liveEditorState[target]?.items.length)

  const saveLiveEditorChanges = async (target: 'video' | 'audio') => {
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
        loop_mode: loopModeForEditor(editor),
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
  }

  const renderLiveEditorPanel = (target: 'video' | 'audio') => {
    const editor = liveEditorState[target]
    const titleKey =
      target === 'video' ? 'streams.liveEdit.videoTitle' : 'streams.liveEdit.audioTitle'
    const assetsPool = target === 'video' ? videoAssets : audioAssets

    if (!editor) {
      return (
        <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <h4 className="font-semibold text-slate-900 dark:text-white">{tStreaming(titleKey)}</h4>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            {tStreaming('streams.liveEdit.missing')}
          </p>
        </div>
      )
    }

    return (
      <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/70 flex flex-col space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-slate-900 dark:text-white">{tStreaming(titleKey)}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {tStreaming('streams.liveEdit.queueHeading')}
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={editor.loop}
                onChange={() => toggleLiveEditorOption(target, 'loop')}
              />
              {tStreaming('streams.liveEdit.toggleLoop')}
            </label>
            <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={editor.shuffle}
                onChange={() => toggleLiveEditorOption(target, 'shuffle')}
              />
              {tStreaming('streams.liveEdit.toggleShuffle')}
            </label>
          </div>
        </div>

        <div className="space-y-2">
          {editor.items.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {tStreaming('streams.liveEdit.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {editor.items.map((item, index) => {
                const asset = assetMap.get(item.asset_id)
                return (
                  <li
                    key={`${item.asset_id}-${index}`}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
                  >
                    <div className="flex items-center gap-3">
                      <GripVertical className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">
                          {asset?.filename ??
                            (target === 'video'
                              ? tStreaming('streams.builder.video.unknownAsset')
                              : tStreaming('streams.builder.audio.unknownAsset'))}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          #{index + 1}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => moveLiveEditorItem(target, index, index - 1)}
                        disabled={index === 0}
                      >
                        <ChevronUp className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => moveLiveEditorItem(target, index, index + 1)}
                        disabled={index === editor.items.length - 1}
                      >
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeLiveEditorItem(target, index)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {tStreaming('streams.liveEdit.availableHeading')}
          </p>
          <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
            {assetsPool && assetsPool.length > 0 ? (
              assetsPool.map((asset) => {
                const alreadySelected = editor.items.some((item) => item.asset_id === asset.id)
                return (
                  <button
                    key={asset.id}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      alreadySelected
                        ? 'border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800'
                        : 'border-slate-200 hover:border-primary-500 hover:text-primary-600 dark:border-slate-700'
                    )}
                    disabled={alreadySelected}
                    onClick={() => addAssetToLiveEditor(target, asset.id)}
                  >
                    {asset.filename}
                  </button>
                )
              })
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {tStreaming('streams.liveEdit.availableEmpty')}
              </p>
            )}
          </div>
        </div>

        <Button
          className="mt-auto"
          onClick={() => saveLiveEditorChanges(target)}
          isLoading={liveEditorSaving[target]}
          disabled={!liveEditorHasSelection(target)}
        >
          {tStreaming('streams.liveEdit.actions.save')}
        </Button>
      </div>
    )
  }

  const handleSubmitChannel = (event: React.FormEvent) => {
    event.preventDefault()
    if (editingChannelId) {
      updateDestinationMutation.mutate({ id: editingChannelId, data: channelForm })
    } else {
      createDestinationMutation.mutate(channelForm)
    }
  }

  const handleEditChannel = (destination: Destination) => {
    setEditingChannelId(destination.id)
    setChannelForm({
      name: destination.name,
      rtmps_url: destination.rtmps_url,
      stream_key: '',
      enabled: destination.enabled,
    })
    setShowChannelForm(true)
  }

  const handleDeleteChannel = (destinationId: string) => {
    if (confirm(tStreaming('channels.form.confirmDelete'))) {
      deleteDestinationMutation.mutate(destinationId)
    }
  }

  const renderStatusBadge = (status: StreamStatusValue) => (
    <Badge variant={statusVariantMap[status]}>{streamingStatus(status)}</Badge>
  )

  if (!user) {
    return <LoadingState text={tStreaming('loading')} />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">{tStreaming('header.title')}</h2>
          <p className="text-slate-600 dark:text-slate-400">{tStreaming('header.description')}</p>
          <div className="mt-3 inline-flex items-center space-x-2 rounded-full bg-primary-50 dark:bg-primary-900/20 px-3 py-1 text-xs font-medium text-primary-700 dark:text-primary-300">
            <span>{tStreaming('header.planLabel')}</span>
            <span className="font-semibold">
              {quotaLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                activePlanLabel
              )}
            </span>
          </div>
        </div>
        <Button onClick={() => setShowCreateStream(true)} className="flex items-center space-x-2">
          <Play className="w-4 h-4" />
          <span>{tStreaming('header.goLive')}</span>
        </Button>
      </div>

      {/* Main Layout: Channels Sidebar + Streams Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Channels Sidebar */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center space-x-2">
                <TvMinimal className="w-5 h-5" />
                <CardTitle className="text-base">{tStreaming('channels.title')}</CardTitle>
              </div>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setShowChannelForm(true)}>
                <Plus className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoadingDestinations ? (
                <LoadingState />
              ) : destinations && destinations.length > 0 ? (
                <>
                  {destinations.map((destination) => (
                    <motion.div key={destination.id} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                      <div
                        onClick={() => setSelectedChannel(destination.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedChannel(destination.id)
                          }
                        }}
                        className={cn(
                          'w-full text-left p-3 rounded-lg border transition-all cursor-pointer',
                          selectedChannel === destination.id
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{destination.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-1">
                              {destination.rtmps_url.split('/').pop()}
                            </p>
                          </div>
                          <Badge variant={destination.enabled ? 'success' : 'secondary'} className="ml-2">
                            {destination.enabled
                              ? tStreaming('channels.badge.active')
                              : tStreaming('channels.badge.disabled')}
                          </Badge>
                        </div>
                        <div className="flex gap-1 mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEditChannel(destination)
                            }}
                          >
                            <Edit className="w-3 h-3 mr-1" />
                            {tStreaming('channels.actions.edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-error-600"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteChannel(destination.id)
                            }}
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            {tStreaming('channels.actions.delete')}
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => setShowChannelForm(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    {tStreaming('channels.add')}
                  </Button>
                </>
              ) : (
                <div className="text-center py-8">
                  <TvMinimal className="w-12 h-12 mx-auto text-slate-400 mb-3" />
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{tStreaming('channels.empty.title')}</p>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setShowChannelForm(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    {tStreaming('channels.add')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card className="mt-4">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">{tStreaming('channels.stats.total')}</span>
                  <span className="text-lg font-bold">
                    {quotaLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      `${destinations?.length || 0}/${formatLimitValue(destinationsLimit)}`
                    )}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">{tStreaming('channels.stats.active')}</span>
                  <span className="text-lg font-bold text-success-600">
                    {destinations?.filter((c) => c.enabled).length || 0}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Live Streams Panel */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center space-x-2">
                <Radio className="w-5 h-5" />
                <CardTitle>{tStreaming('streams.title')}</CardTitle>
              </div>
              <Button className="flex items-center space-x-2" onClick={() => setShowCreateStream(true)}>
                <Plus className="w-4 h-4" />
                <span>{tStreaming('streams.new')}</span>
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingStreams ? (
                <LoadingState text={tStreaming('fetching')} />
              ) : streams && streams.length > 0 ? (
                <div className="space-y-4">
                  {streams.map((stream) => (
                    <motion.div
                      key={stream.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="border border-slate-200 dark:border-slate-700 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h3 className="text-lg font-semibold">{stream.name || tStreaming('streams.untitled')}</h3>
                            {renderStatusBadge(stream.status)}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">{tStreaming('streams.labels.playlist')}</p>
                              <p className="font-medium">
                                {stream.playlist_id
                                  ? playlistMap.get(stream.playlist_id)?.name ?? tStreaming('streams.unknownPlaylist')
                                  : tStreaming('streams.unknownPlaylist')}
                              </p>
                            </div>
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">{tStreaming('streams.labels.status')}</p>
                              <p className="font-medium">{streamingStatus(stream.status)}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">{tStreaming('streams.labels.created')}</p>
                              <p className="font-medium">{formatDistanceToNow(new Date(stream.created_at), { addSuffix: true, locale: dateLocale })}</p>
                            </div>
                          </div>

                          {stream.error_message && (
                            <p className="text-sm text-error-600 dark:text-error-400 flex items-center gap-2 mt-2">
                              <Activity className="w-4 h-4" />
                              {stream.error_message}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center space-x-2 ml-4">
                          <Button size="sm" variant="outline" onClick={() => setViewingLogs(stream.id)}>
                            {tStreaming('streams.buttons.logs')}
                          </Button>
                          {stream.status === 'running' && (
                            <Button size="sm" variant="outline" onClick={() => openLiveEditor(stream)}>
                              <Edit className="w-4 h-4 mr-2" />
                              {tStreaming('streams.liveEdit.button')}
                            </Button>
                          )}
                          {stream.status === 'running' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              isLoading={stopStreamMutation.isPending}
                              onClick={() => stopStreamMutation.mutate(stream.id)}
                            >
                              <Square className="w-4 h-4 mr-2" />
                              {tStreaming('streams.buttons.stop')}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              isLoading={startStreamMutation.isPending}
                              onClick={() =>
                                startStreamMutation.mutate({
                                  streamId: stream.id,
                                  streamName: stream.name,
                                })
                              }
                            >
                              <Play className="w-4 h-4 mr-2" />
                              {tStreaming('streams.buttons.start')}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="danger"
                            isLoading={deleteStreamMutation.isPending}
                            onClick={() => deleteStreamMutation.mutate(stream.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16">
                  <Radio className="w-16 h-16 mx-auto text-slate-400 mb-4" />
                  <p className="text-slate-600 dark:text-slate-400 mb-4">{tStreaming('streams.empty.title')}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-500 mb-6">
                    {tStreaming('streams.empty.description')}
                  </p>
                  <Button variant="primary" size="lg" onClick={() => setShowCreateStream(true)}>
                    <Plus className="w-5 h-5 mr-2" />
                    {tStreaming('streams.empty.cta')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stream Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-success-600">
                    {streams?.filter((s) => s.status === 'running').length || 0}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tStreaming('streams.stats.active')}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold gradient-text">{streams?.length || 0}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tStreaming('streams.stats.total')}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold gradient-text">
                    {quotaLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    ) : (
                      `${streams?.filter((s) => s.status === 'running').length || 0}/${formatLimitValue(concurrentStreamsLimit)}`
                    )}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tStreaming('streams.stats.concurrent')}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Channel Form Modal */}
      {showChannelForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-lg animate-scale-in">
            <CardHeader>
              <CardTitle>
                {editingChannelId ? tStreaming('channels.form.editTitle') : tStreaming('channels.form.newTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmitChannel} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {tStreaming('channels.form.nameLabel')}
                  </label>
                  <Input
                    type="text"
                    required
                    value={channelForm.name}
                    onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })}
                    placeholder={tStreaming('channels.form.namePlaceholder')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {tStreaming('channels.form.urlLabel')}
                  </label>
                  <Input
                    type="text"
                    required
                    value={channelForm.rtmps_url}
                    onChange={(e) => setChannelForm({ ...channelForm, rtmps_url: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {tStreaming('channels.form.keyLabel')}{' '}
                    {editingChannelId ? tStreaming('channels.form.keepExisting') : ''}
                  </label>
                  <Input
                    type="password"
                    required={!editingChannelId}
                    value={channelForm.stream_key}
                    onChange={(e) => setChannelForm({ ...channelForm, stream_key: e.target.value })}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {tStreaming('channels.form.keyHint')}
                  </p>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={channelForm.enabled}
                    onChange={(e) => setChannelForm({ ...channelForm, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                  />
                  <label className="ml-2 block text-sm text-slate-700 dark:text-slate-300">
                    {tStreaming('channels.form.enabled')}
                  </label>
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" onClick={resetChannelForm} variant="secondary">
                    {tStreaming('channels.form.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    isLoading={createDestinationMutation.isPending || updateDestinationMutation.isPending}
                  >
                    {editingChannelId ? tStreaming('channels.form.update') : tStreaming('channels.form.create')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {qualityGate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-2xl animate-scale-in">
            <CardHeader>
              <CardTitle>{tStreaming('streams.quality.title')}</CardTitle>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {tStreaming('streams.quality.description', {
                  name: qualityGate.streamName || tStreaming('streams.untitled'),
                })}
              </p>
              <Badge variant="info" className="w-max mt-2 text-xs font-medium">
                {tStreaming('streams.quality.plan', { plan: activePlanLabel })}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {tStreaming('streams.quality.limits.resolution')}
                  </p>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">
                    {qualityGate.quality.limits.max_resolution_height
                      ? `${qualityGate.quality.limits.max_resolution_height}p`
                      : tStreaming('streams.quality.limits.unlimited')}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {tStreaming('streams.quality.limits.fps')}
                  </p>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">
                    {qualityGate.quality.limits.max_fps ?? tStreaming('streams.quality.limits.unlimited')}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {tStreaming('streams.quality.limits.bitrate')}
                  </p>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">
                    {qualityGate.quality.limits.max_video_bitrate_mbps
                      ? `${qualityGate.quality.limits.max_video_bitrate_mbps} Mbps`
                      : tStreaming('streams.quality.limits.unlimited')}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-primary-200 dark:border-primary-700/60 bg-primary-50/60 dark:bg-primary-900/30 p-4">
                <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                  {tStreaming('streams.quality.recommended.title')}
                </p>
                {(() => {
                  const recommendation = qualityGate.quality.recommended
                  const resolution = (() => {
                    if (recommendation?.resolution) {
                      return recommendation.resolution
                    }
                    if (qualityGate.quality.limits.max_resolution_height) {
                      return `${qualityGate.quality.limits.max_resolution_height}p`
                    }
                    if (planQualityLimits?.max_resolution) {
                      return planQualityLimits.max_resolution
                    }
                    return tStreaming('streams.quality.limits.unlimited')
                  })()

                  const fpsLimit =
                    recommendation?.fps ??
                    qualityGate.quality.limits.max_fps ??
                    planQualityLimits?.max_fps ??
                    null
                  const fpsDisplay = fpsLimit != null ? fpsLimit.toString() : '∞'

                  const minBitrate =
                    recommendation?.min_bitrate_mbps ??
                    qualityGate.quality.limits.min_video_bitrate_mbps ??
                    null
                  const maxBitrate =
                    recommendation?.max_bitrate_mbps ??
                    qualityGate.quality.limits.max_video_bitrate_mbps ??
                    null
                  const targetBitrate = recommendation?.target_bitrate_mbps ?? null
                  const videoCodec = recommendation?.video_codec ?? 'H.264'
                  const audioCodec = recommendation?.audio_codec ?? 'AAC'

                  const formatValue = (value: number | null) => {
                    if (value == null) return null
                    const trimmed = value.toFixed(2).replace(/\.00$/, '')
                    return trimmed
                  }

                  const rangeText = (() => {
                    const min = formatValue(minBitrate)
                    const max = formatValue(maxBitrate)

                    if (min && max) return `${min}–${max} Mbps`
                    if (min) return `≥ ${min} Mbps`
                    if (max) return `≤ ${max} Mbps`
                    return tStreaming('streams.quality.limits.unlimited')
                  })()

                  const targetClause = targetBitrate != null
                    ? tStreaming('streams.quality.recommended.targetClause', {
                        target: formatValue(targetBitrate) ?? '—',
                      })
                    : ''

                  return (
                    <p className="text-sm text-primary-700 dark:text-primary-300 mt-1">
                      {tStreaming('streams.quality.recommended.description', {
                        resolution,
                        fps: fpsDisplay,
                        videoCodec,
                        audioCodec,
                        bitrateRange: rangeText,
                        targetClause,
                      })}
                    </p>
                  )
                })()}
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {tStreaming('streams.quality.detailsHeading')}
                </h4>
                <div className="space-y-3">
                  {groupedQualityViolations.map((group) => (
                    <div
                      key={group.assetKey}
                      className="rounded-lg border border-error-200 dark:border-error-700 bg-error-50/80 dark:bg-error-900/20 p-3"
                    >
                      <p className="text-sm font-semibold text-error-700 dark:text-error-300">
                        {group.filename ??
                          tStreaming('streams.quality.unknownAsset', { index: group.position + 1 })}
                      </p>

                      <div className="mt-2 space-y-2">
                        {group.issues.map(({ violation }, issueIndex) => {
                          const messageKey =
                            violationTranslationKey[violation.code ?? ''] ??
                            'streams.quality.violations.default'

                          return (
                            <div key={`${group.assetKey}-${violation.code ?? issueIndex}`}>
                              <p className="text-sm text-error-700 dark:text-error-300">
                                {tStreaming(messageKey as any, {
                                  current: violation.current ?? '—',
                                  allowed: violation.allowed ?? '—',
                                })}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <Button variant="secondary" onClick={() => setQualityGate(null)}>
                {tStreaming('streams.quality.cta.close')}
              </Button>
              <Button
                onClick={() => {
                  setQualityGate(null)
                  router.push('/dashboard/library')
                }}
              >
                {tStreaming('streams.quality.cta.library')}
              </Button>
            </div>
          </Card>
        </div>
      )}
      {/* Create Stream Modal */}
      {showCreateStream && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-5xl animate-scale-in">
            <CardHeader className="flex items-start justify-between space-y-0">
              <div>
                <CardTitle>{tStreaming('streams.form.title')}</CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {tStreaming('streams.builder.subtitle')}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={resetStreamForm}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/70">
                  <div className="flex items-center gap-3">
                    <Info className="h-5 w-5 text-primary-500" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {tStreaming('streams.builder.info.capacity')}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        {tStreaming('streams.builder.info.capacityDescription', {
                          count: runningStreams.length,
                          limit: formatLimitValue(concurrentStreamsLimit),
                        })}
                      </p>
                    </div>
                  </div>
                </div>
                {errorStreams.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-400/60 dark:bg-amber-500/10">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-300" />
                      <div>
                        <p className="text-sm font-semibold text-amber-700 dark:text-amber-200">
                          {tStreaming('streams.builder.info.alert')}
                        </p>
                        <p className="text-xs text-amber-700/80 dark:text-amber-200/80">
                          {tStreaming('streams.builder.info.alertDescription', { count: errorStreams.length })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <Tabs value={activeBuilderTab} onValueChange={(value) => setActiveBuilderTab(value as BuilderTab)}>
                <TabsList className="grid grid-cols-4">
                  <TabsTrigger value="video" className="flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    {tStreaming('streams.builder.tabs.video')}
                  </TabsTrigger>
                  <TabsTrigger value="audio" className="flex items-center gap-2">
                    <Music3 className="h-4 w-4" />
                    {tStreaming('streams.builder.tabs.audio')}
                  </TabsTrigger>
                  <TabsTrigger value="destinations" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {tStreaming('streams.builder.tabs.destinations')}
                  </TabsTrigger>
                  <TabsTrigger value="schedule" className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4" />
                    {tStreaming('streams.builder.tabs.schedule')}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="video" className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {tStreaming('streams.builder.video.collectionLabel')}
                    </label>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center">
                      <select
                        className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                        value={videoEditor.selectedCollectionId ?? 'custom'}
                        onChange={(event) => handleSelectCollection('video', event.target.value as string)}
                      >
                        <option value="custom">{tStreaming('streams.builder.video.collectionPlaceholder')}</option>
                        {(videoCollections ?? []).map((collection) => (
                          <option key={collection.id} value={collection.id}>
                            {collection.name}
                          </option>
                        ))}
                      </select>
                      {videoEditor.mode === 'existing' && (
                        <Button variant="outline" size="sm" onClick={() => handleCustomizeExisting('video')}>
                          {tStreaming('streams.builder.video.customize')}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={videoEditor.loop ? 'primary' : 'secondary'}
                      onClick={() => updateEditor('video', (prev) => ({ ...prev, loop: !prev.loop, mode: 'custom' }))}
                    >
                      <Repeat className="mr-1 h-4 w-4" />
                      {tStreaming('streams.builder.video.loop')}
                    </Button>
                    <Button
                      size="sm"
                      variant={videoEditor.shuffle ? 'primary' : 'secondary'}
                      onClick={() => updateEditor('video', (prev) => ({ ...prev, shuffle: !prev.shuffle, mode: 'custom' }))}
                    >
                      <Shuffle className="mr-1 h-4 w-4" />
                      {tStreaming('streams.builder.video.shuffle')}
                    </Button>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                          {tStreaming('streams.builder.video.queueHeading')}
                        </h4>
                        {videoEditor.items.length > 0 && (
                          <Button variant="ghost" size="sm" onClick={() => updateEditor('video', (prev) => ({ ...prev, items: [] }))}>
                            {tStreaming('streams.builder.video.clear')}
                          </Button>
                        )}
                      </div>
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 max-h-72 overflow-y-auto">
                        {videoEditor.items.length > 0 ? (
                          videoEditor.items.map((item, index) => {
                            const asset = assetMap.get(item.asset_id)
                            const draggable = videoEditor.mode === 'custom'
                            return (
                              <div
                                key={`${item.asset_id}-${index}`}
                                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                                draggable={draggable}
                                onDragStart={() => handleItemDragStart('video', index)}
                                onDragOver={(event) => {
                                  if (!draggable) return
                                  event.preventDefault()
                                }}
                                onDrop={() => draggable && handleItemDrop('video', index)}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <GripVertical className={`h-4 w-4 text-slate-400 ${!draggable ? 'opacity-40' : ''}`} />
                                  <p className="truncate font-medium text-slate-900 dark:text-white">
                                    {asset?.filename ?? tStreaming('streams.builder.video.unknownAsset')}
                                  </p>
                                </div>
                                {draggable && (
                                  <Button variant="ghost" size="icon" onClick={() => removeAssetFromEditor('video', item.asset_id)}>
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            )
                          })
                        ) : (
                          <p className="text-sm text-slate-500">{tStreaming('streams.builder.video.empty')}</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {tStreaming('streams.builder.video.assetsHeading')}
                      </h4>
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 max-h-72 overflow-y-auto">
                        {isLoadingAssets ? (
                          <LoadingState text={tStreaming('loading')} />
                        ) : videoAssets.length > 0 ? (
                          videoAssets.map((asset) => {
                            const isSelected = videoEditor.items.some((entry) => entry.asset_id === asset.id)
                            return (
                              <button
                                key={`video-source-${asset.id}`}
                                type="button"
                                onClick={() => addAssetToEditor('video', asset.id)}
                                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                                  isSelected
                                    ? 'border-primary-400 bg-primary-50/60 dark:border-primary-500 dark:bg-primary-900/30'
                                    : 'border-slate-200 hover:border-primary-300 dark:border-slate-600 dark:hover:border-primary-500'
                                }`}
                              >
                                <span className="truncate">{asset.filename}</span>
                                <Badge variant={isSelected ? 'success' : 'secondary'}>
                                  {isSelected
                                    ? tStreaming('channels.badge.selected')
                                    : tStreaming('channels.badge.tapToSelect')}
                                </Badge>
                              </button>
                            )
                          })
                        ) : (
                          <p className="text-sm text-slate-500">{tStreaming('streams.builder.video.noAssets')}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="audio" className="mt-4 space-y-4">
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {tStreaming('streams.builder.audio.title')}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {tStreaming('streams.builder.audio.subtitle')}
                      </p>
                    </div>
                    <Button variant={audioEnabled ? 'primary' : 'secondary'} size="sm" onClick={() => handleAudioToggle(!audioEnabled)}>
                      {audioEnabled ? tStreaming('streams.builder.audio.disable') : tStreaming('streams.builder.audio.enable')}
                    </Button>
                  </div>

                  {!audioEnabled ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {tStreaming('streams.builder.audio.disabledNotice')}
                    </p>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                          {tStreaming('streams.builder.audio.collectionLabel')}
                        </label>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center">
                          <select
                            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                            value={audioEditor.selectedCollectionId ?? 'custom'}
                            onChange={(event) => handleSelectCollection('audio', event.target.value as string)}
                          >
                            <option value="custom">{tStreaming('streams.builder.audio.collectionPlaceholder')}</option>
                            {(audioCollections ?? []).map((collection) => (
                              <option key={collection.id} value={collection.id}>
                                {collection.name}
                              </option>
                            ))}
                          </select>
                          {audioEditor.mode === 'existing' && (
                            <Button variant="outline" size="sm" onClick={() => handleCustomizeExisting('audio')}>
                              {tStreaming('streams.builder.audio.customize')}
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant={audioEditor.loop ? 'primary' : 'secondary'}
                          onClick={() => updateEditor('audio', (prev) => ({ ...prev, loop: !prev.loop, mode: 'custom' }))}
                        >
                          <Repeat className="mr-1 h-4 w-4" />
                          {tStreaming('streams.builder.audio.loop')}
                        </Button>
                        <Button
                          size="sm"
                          variant={audioEditor.shuffle ? 'primary' : 'secondary'}
                          onClick={() => updateEditor('audio', (prev) => ({ ...prev, shuffle: !prev.shuffle, mode: 'custom' }))}
                        >
                          <Shuffle className="mr-1 h-4 w-4" />
                          {tStreaming('streams.builder.audio.shuffle')}
                        </Button>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                            {tStreaming('streams.builder.audio.queueHeading')}
                          </h4>
                          <div className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 max-h-64 overflow-y-auto">
                            {audioEditor.items.length > 0 ? (
                              audioEditor.items.map((item, index) => {
                                const asset = assetMap.get(item.asset_id)
                                const draggable = audioEditor.mode === 'custom'
                                return (
                                  <div
                                    key={`${item.asset_id}-${index}`}
                                    className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                                    draggable={draggable}
                                    onDragStart={() => handleItemDragStart('audio', index)}
                                    onDragOver={(event) => {
                                      if (!draggable) return
                                      event.preventDefault()
                                    }}
                                    onDrop={() => draggable && handleItemDrop('audio', index)}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <GripVertical className={`h-4 w-4 text-slate-400 ${!draggable ? 'opacity-40' : ''}`} />
                                      <p className="truncate font-medium text-slate-900 dark:text-white">
                                        {asset?.filename ?? tStreaming('streams.builder.audio.unknownAsset')}
                                      </p>
                                    </div>
                                    {draggable && (
                                      <Button variant="ghost" size="icon" onClick={() => removeAssetFromEditor('audio', item.asset_id)}>
                                        <X className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                )
                              })
                            ) : (
                              <p className="text-sm text-slate-500">{tStreaming('streams.builder.audio.empty')}</p>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                            {tStreaming('streams.builder.audio.assetsHeading')}
                          </h4>
                          <div className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 max-h-64 overflow-y-auto">
                            {isLoadingAssets ? (
                              <LoadingState text={tStreaming('loading')} />
                            ) : audioAssets.length > 0 ? (
                              audioAssets.map((asset) => {
                                const isSelected = audioEditor.items.some((entry) => entry.asset_id === asset.id)
                                return (
                                  <button
                                    key={`audio-source-${asset.id}`}
                                    type="button"
                                    onClick={() => addAssetToEditor('audio', asset.id)}
                                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                                      isSelected
                                        ? 'border-primary-400 bg-primary-50/60 dark:border-primary-500 dark:bg-primary-900/30'
                                        : 'border-slate-200 hover:border-primary-300 dark:border-slate-600 dark:hover-border-primary-500'
                                    }`}
                                  >
                                    <span className="truncate">{asset.filename}</span>
                                    <Badge variant={isSelected ? 'success' : 'secondary'}>
                                      {isSelected
                                        ? tStreaming('channels.badge.selected')
                                        : tStreaming('channels.badge.tapToSelect')}
                                    </Badge>
                                  </button>
                                )
                              })
                            ) : (
                              <p className="text-sm text-slate-500">{tStreaming('streams.builder.audio.noAssets')}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="destinations" className="mt-4 space-y-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {tStreaming('streams.builder.destinations.title')}
                    </label>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {tStreaming('streams.builder.destinations.subtitle')}
                    </p>
                  </div>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {isLoadingDestinations ? (
                      <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 p-6 dark:border-slate-700">
                        <LoadingState text={tStreaming('streams.builder.destinations.loading')} />
                      </div>
                    ) : destinations && destinations.length > 0 ? (
                      destinations.map((destination) => {
                        const isSelected = streamForm.destination_ids.includes(destination.id)
                        return (
                          <label
                            key={`destination-${destination.id}`}
                            htmlFor={`destination-checkbox-${destination.id}`}
                            className={cn(
                              'flex w-full items-center justify-between rounded-lg border px-3 py-3 transition-colors bg-white dark:bg-slate-900/40',
                              isSelected
                                ? 'border-success-500 bg-success-100 dark:border-success-500/80 dark:bg-success-900/30'
                                : 'border-slate-200 dark:border-slate-700 hover:border-primary-300 hover:bg-primary-50/40 dark:hover:border-primary-500 dark:hover:bg-primary-900/20',
                              destination.enabled ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                id={`destination-checkbox-${destination.id}`}
                                type="checkbox"
                                disabled={!destination.enabled}
                                checked={isSelected}
                                onChange={() => handleDestinationToggle(destination.id)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed disabled:border-slate-300"
                              />
                              <div>
                                <p className="text-sm font-medium text-slate-900 dark:text-white">{destination.name}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{destination.rtmps_url}</p>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <Badge variant={destination.enabled ? (isSelected ? 'success' : 'secondary') : 'warning'}>
                                {destination.enabled
                                  ? isSelected
                                    ? tStreaming('channels.badge.selected')
                                    : tStreaming('channels.badge.tapToSelect')
                                  : tStreaming('streams.builder.destinations.disabled')}
                              </Badge>
                              {destination.enabled ? (
                                <span className="text-[11px] font-medium uppercase text-slate-400 dark:text-slate-500">
                                  {isSelected
                                    ? tStreaming('streams.builder.destinations.selected')
                                    : tStreaming('streams.builder.destinations.toggleHint')}
                                </span>
                              ) : (
                                <span className="text-[11px] font-medium uppercase text-amber-500">
                                  {tStreaming('streams.builder.destinations.enableHint')}
                                </span>
                              )}
                            </div>
                          </label>
                        )
                      })
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300 space-y-3 text-center">
                        <p>{tStreaming('streams.builder.destinations.none')}</p>
                        <Button size="sm" variant="outline" onClick={() => setShowChannelForm(true)}>
                          {tStreaming('streams.builder.destinations.cta')}
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="schedule" className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {tStreaming('streams.form.nameLabel')}
                    </label>
                    <Input
                      placeholder={tStreaming('streams.form.namePlaceholder')}
                      value={streamForm.name}
                      onChange={(event) => setStreamForm((prev) => ({ ...prev, name: event.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {tStreaming('streams.builder.schedule.title')}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={scheduleState.startMode === 'now' ? 'primary' : 'secondary'}
                        onClick={() => setScheduleState((prev) => ({ ...prev, startMode: 'now' }))}
                      >
                        {tStreaming('streams.builder.schedule.startNow')}
                      </Button>
                      <Button
                        size="sm"
                        variant={scheduleState.startMode === 'schedule' ? 'primary' : 'secondary'}
                        onClick={() => setScheduleState((prev) => ({ ...prev, startMode: 'schedule' }))}
                      >
                        {tStreaming('streams.builder.schedule.startLater')}
                      </Button>
                    </div>
                    {scheduleState.startMode === 'schedule' && (
                      <Input
                        type="datetime-local"
                        value={scheduleState.startAt}
                        onChange={(event) => setScheduleState((prev) => ({ ...prev, startAt: event.target.value }))}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={scheduleState.loopStream ? 'primary' : 'secondary'}
                      onClick={() => setScheduleState((prev) => ({ ...prev, loopStream: !prev.loopStream }))}
                    >
                      <Repeat className="mr-1 h-4 w-4" />
                      {tStreaming('streams.builder.schedule.loop')}
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {tStreaming('streams.builder.schedule.videoVolume')}: {scheduleState.videoVolume}%
                      </label>
                      <div className="flex items-center gap-2">
                        <Volume2 className="h-4 w-4 text-slate-400" />
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={scheduleState.videoVolume}
                          onChange={(event) => setScheduleState((prev) => ({ ...prev, videoVolume: Number(event.target.value) }))}
                          className="flex-1"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {tStreaming('streams.builder.schedule.audioVolume')}: {audioEnabled ? scheduleState.audioVolume : 0}%
                      </label>
                      <div className="flex items-center gap-2">
                        <VolumeX className={`h-4 w-4 ${audioEnabled ? 'text-slate-400' : 'text-slate-300'}`} />
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={audioEnabled ? scheduleState.audioVolume : 0}
                          disabled={!audioEnabled}
                          onChange={(event) => setScheduleState((prev) => ({ ...prev, audioVolume: Number(event.target.value) }))}
                          className="flex-1"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {tStreaming('streams.builder.schedule.summaryTitle')}
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                      <li>
                        {videoEditor.selectedCollectionId
                          ? tStreaming('streams.builder.schedule.summaryVideoSaved')
                          : tStreaming('streams.builder.schedule.summaryVideoCount', {
                              count: videoEditor.items.length,
                            })}
                      </li>
                      <li>
                        {audioEnabled
                          ? audioEditor.selectedCollectionId
                            ? tStreaming('streams.builder.schedule.summaryAudioSaved')
                            : tStreaming('streams.builder.schedule.summaryAudioCount', {
                                count: audioEditor.items.length,
                              })
                          : tStreaming('streams.builder.schedule.summaryAudioDisabled')}
                      </li>
                      <li>
                        {tStreaming('streams.builder.schedule.summaryDestinations', {
                          count: streamForm.destination_ids.length,
                        })}
                      </li>
                    </ul>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <Button variant="ghost" onClick={resetStreamForm}>
                    {tStreaming('streams.builder.actions.cancel')}
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setActiveBuilderTab(builderTabsList[Math.max(0, currentTabIndex - 1)])}
                      disabled={currentTabIndex === 0}
                    >
                      {tStreaming('streams.builder.actions.back')}
                    </Button>
                    {isFinalTab ? (
                      <Button
                        onClick={handleBuilderSubmit}
                        isLoading={isBuilderSubmitting || createStreamMutation.isPending}
                      >
                        {tStreaming('streams.builder.actions.create')}
                      </Button>
                    ) : (
                      <Button onClick={() => setActiveBuilderTab(builderTabsList[Math.min(builderTabsList.length - 1, currentTabIndex + 1)])}>
                        {tStreaming('streams.builder.actions.next')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Logs Viewer Modal */}
      {viewingLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-4xl animate-scale-in">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{tStreaming('streams.logs.title')}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setViewingLogs(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="bg-slate-900 text-slate-100 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
                {logsResponse?.logs?.length ? (
                  logsResponse.logs.map((line, index) => <p key={index}>{line}</p>)
                ) : (
                  <p>{tStreaming('streams.logs.empty')}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {liveEditingStream && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-5xl animate-scale-in">
            <CardHeader className="flex items-start justify-between space-y-0">
              <div>
                <CardTitle>
                  {tStreaming('streams.liveEdit.title', {
                    name: liveEditingStream.name || tStreaming('streams.untitled'),
                  })}
                </CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {tStreaming('streams.liveEdit.subtitle')}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={resetLiveEditor}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {liveEditorLoading ? (
                <LoadingState text={tStreaming('streams.liveEdit.loading')} />
              ) : (
                <div className="space-y-6">
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {tStreaming('streams.liveEdit.restartNotice')}
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {renderLiveEditorPanel('video')}
                    {liveEditingStream.audio_collection_id
                      ? renderLiveEditorPanel('audio')
                      : (
                        <div className="rounded-xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
                          <h4 className="font-semibold text-slate-900 dark:text-white">
                            {tStreaming('streams.liveEdit.audioTitle')}
                          </h4>
                          <p className="mt-2">{tStreaming('streams.liveEdit.disabledAudio')}</p>
                        </div>
                      )}
                  </div>
                </div>
              )}
              <div className="flex justify-end">
                <Button variant="outline" onClick={resetLiveEditor}>
                  {tStreaming('streams.liveEdit.actions.close')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
