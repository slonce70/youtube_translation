'use client'
/* eslint-disable i18next/no-literal-string */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Play, Loader2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'

import { api, ApiError } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import type {
  Destination,
  DestinationUpdatePayload,
  Asset,
  Stream,
  Playlist,
  StreamLogsResponse,
  StreamStatusResponse,
  StreamQualityResponse,
  SubscriptionTierKey,
  MediaCollection,
  StreamSchedulePayload,
  YoutubeConnection,
} from '@/lib/types'
import { useDashboardContext } from '../dashboard-context'
import { StreamBuilderModal } from './components/StreamBuilderModal'
import { LiveEditorModal } from './components/LiveEditorModal'
import { QualityGateModal } from './components/QualityGateModal'
import { useLiveEditor } from './hooks/useLiveEditor'
import { useQualityGate } from './hooks/useQualityGate'
import { useStreamStatusMap } from './hooks/useStreamStatusMap'
import { AddChannelModal } from '@/components/streaming/AddChannelModal'
import {
  buildStreamIncidentNotice,
  deriveStreamState,
  getStreamLogLineClassName,
  summarizeStreamLogIncidents,
} from '@/lib/stream-state'
import { getDestinationPlatformPresentation } from './platform'
import { formatDuration } from '@/lib/utils'
import { formatDateTimeLocal, type ScheduleDraft } from './schedule-utils'
import { extractStopAuditEntries } from './log-audit'
import {
  getProviderStatusKey,
  getProviderBadgeVariant,
  getProviderHealthIssueCount,
  hasProviderHealthAttention,
} from '@/lib/provider-status'

type DestinationFormState = {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
  provider_connection_id: string | null
}

export default function StreamingPage() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, quota, currentTier } = useDashboardContext()
  const planNames = useTranslations('dashboard.quota.tiers')
  const activePlanLabel = planNames((currentTier ?? 'free') as SubscriptionTierKey)
  const streamingToasts = useTranslations('streaming.toasts')
  const tStreaming = useTranslations('streaming.page')
  const { qualityGate, openQualityGate, closeQualityGate, groupedViolations } = useQualityGate()

  useEffect(() => {
    if (searchParams?.get('new') === '1') {
      setShowCreateStream(true)
      router.replace('/dashboard/streaming', { scroll: false })
    }
  }, [router, searchParams])

  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [channelForm, setChannelForm] = useState<DestinationFormState>({
    name: '',
    rtmps_url: 'rtmps://a.rtmp.youtube.com/live2',
    stream_key: '',
    enabled: true,
    provider_connection_id: null,
  })
  const [viewingLogs, setViewingLogs] = useState<string | null>(null)
  const [logsMode, setLogsMode] = useState<'important' | 'raw'>('important')
  const [showCreateStream, setShowCreateStream] = useState(false)
  const [activeStreamTab, setActiveStreamTab] = useState<'live' | 'scheduled' | 'archive'>('live')
  const [optimisticRunningStreamIds, setOptimisticRunningStreamIds] = useState<string[]>([])
  const [optimisticStoppingStreamIds, setOptimisticStoppingStreamIds] = useState<string[]>([])
  const [liveEditorScheduleDraft, setLiveEditorScheduleDraft] = useState<ScheduleDraft | null>(null)
  const [liveEditorNameDraft, setLiveEditorNameDraft] = useState('')
  const [liveEditorDestinationIds, setLiveEditorDestinationIds] = useState<string[]>([])

  const { data: destinations, isLoading: isLoadingDestinations } = useQuery<Destination[]>({
    queryKey: ['destinations', user?.id],
    queryFn: () => api.destinations.list(),
    enabled: !!user,
  })

  const { data: youtubeConnections } = useQuery<YoutubeConnection[]>({
    queryKey: ['youtube-connections', user?.id],
    queryFn: () => api.youtube.listConnections(),
    enabled: !!user,
    staleTime: 30_000,
  })

  const { data: streams, isLoading: isLoadingStreams } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id],
    queryFn: () => api.streams.list(),
    enabled: !!user,
    refetchInterval: 3000,
  })

  const liveStatusMap = useStreamStatusMap(streams, user?.id)

  const { data: playlists } = useQuery<Playlist[]>({
    queryKey: ['playlists', user?.id],
    queryFn: () => api.playlists.list(),
    enabled: !!user,
  })

  const { data: assets, isLoading: isLoadingAssets } = useQuery<Asset[]>({
    queryKey: ['assets', user?.id, 'streaming'],
    queryFn: () => api.assets.list(),
    enabled: !!user,
  })

  const { data: videoCollections, isLoading: isLoadingVideoCollections } = useQuery<MediaCollection[]>({
    queryKey: ['media-collections', user?.id, 'video'],
    queryFn: () =>
      api.mediaCollections.list({
        collection_type: 'video_background',
        include_items: true,
      }),
    enabled: !!user,
  })

  const { data: audioCollections, isLoading: isLoadingAudioCollections } = useQuery<MediaCollection[]>({
    queryKey: ['media-collections', user?.id, 'audio'],
    queryFn: () =>
      api.mediaCollections.list({
        collection_type: 'audio_playlist',
        include_items: true,
      }),
    enabled: !!user,
  })

  const playlistMap = useMemo(() => {
    if (!playlists) return new Map<string, Playlist>()
    return new Map(playlists.map((playlist) => [playlist.id, playlist]))
  }, [playlists])
  const videoCollectionMap = useMemo(() => {
    if (!videoCollections) return new Map<string, MediaCollection>()
    return new Map(videoCollections.map((collection) => [collection.id, collection]))
  }, [videoCollections])
  const audioCollectionMap = useMemo(() => {
    if (!audioCollections) return new Map<string, MediaCollection>()
    return new Map(audioCollections.map((collection) => [collection.id, collection]))
  }, [audioCollections])

  const formatLimitValue = (value?: number | null) => (value == null ? '∞' : value.toString())
  const hasProviderConnection = (stream: Stream) =>
    Boolean(stream.destinations?.some((destination) => destination.provider_connection_id))
  const formatProviderStatus = (status?: string | null) =>
    tStreaming(`provider.status.${getProviderStatusKey(status)}`)
  const shouldShowProviderBadge = (destination: Destination) =>
    Boolean(destination.provider_connection_id && destination.provider_status && destination.provider_status !== 'unknown')
  const getStreamSourceLabel = (stream: Stream) => {
    if (stream.video_collection_id) return videoCollectionMap.get(stream.video_collection_id)?.name ?? 'Відеоряд'
    if (stream.playlist_id) return playlistMap.get(stream.playlist_id)?.name ?? 'Плейлист'
    if (stream.stream_assets?.length) return `Черга (${stream.stream_assets.length})`
    return 'Джерело не вказано'
  }
  const getStreamSourceTotalSeconds = (stream: Stream) => {
    const collection = stream.video_collection_id ? videoCollectionMap.get(stream.video_collection_id) : null
    if (collection?.items?.length) {
      const total = collection.items.reduce((sum, item) => sum + (item.asset?.duration_seconds ?? 0), 0)
      return total > 0 ? total : null
    }
    if (stream.stream_assets?.length && assets?.length) {
      const assetDurations = stream.stream_assets
        .map((link) => assets.find((asset) => asset.id === link.asset_id)?.duration_seconds ?? 0)
        .reduce((sum, duration) => sum + duration, 0)
      return assetDurations > 0 ? assetDurations : null
    }
    return null
  }
  const formatProviderSummary = (destination: Destination) => {
    if (!destination.provider_connection_id) return null
    if (!destination.provider_viewers && (!destination.provider_status || destination.provider_status === 'unknown')) return null
    const parts = [formatProviderStatus(destination.provider_status)]
    if (typeof destination.provider_viewers === 'number') {
      parts.push(tStreaming('provider.viewers', { count: destination.provider_viewers }))
    }
    const issueCount = getProviderHealthIssueCount(destination)
    if (issueCount > 0) {
      parts.push(tStreaming('provider.healthIssues', { count: issueCount }))
    } else if (hasProviderHealthAttention(destination)) {
      parts.push(tStreaming('provider.healthDegraded'))
    }
    return parts.join(' · ')
  }
  const destinationsLimit = quota?.destinations?.limit ?? null
  const concurrentStreamsLimit = quota?.streams?.limit ?? null
  const planQualityLimits = quota?.quality

  const createDestinationMutation = useMutation({
    mutationFn: (data: DestinationFormState) => api.destinations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
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
      payload.provider_connection_id = data.provider_connection_id
      return api.destinations.update(id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
      toast.success(streamingToasts('destination.updated'))
      resetChannelForm()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const deleteDestinationMutation = useMutation({
    mutationFn: (destinationId: string) => api.destinations.delete(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
      toast.success(streamingToasts('destination.deleted'))
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const updateScheduleMutation = useMutation({
    mutationFn: ({ streamId, payload }: { streamId: string; payload: StreamSchedulePayload }) =>
      api.streams.update(streamId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
      toast.success(streamingToasts('stream.scheduleUpdated'))
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  type StartStreamVariables = { streamId: string; streamName?: string | null }

  const startStreamMutation = useMutation<
    StreamStatusResponse,
    Error & { quality?: StreamQualityResponse },
    StartStreamVariables
  >({
    mutationFn: async ({ streamId }: StartStreamVariables) => {
      const quality = await api.streams.quality(streamId)
      if (!quality.ok) {
        const error = new Error('quality_rejected') as Error & { quality: StreamQualityResponse }
        error.quality = quality
        throw error
      }
      return api.streams.start(streamId)
    },
    onMutate: async (variables) => {
      setActiveStreamTab('live')
      setOptimisticRunningStreamIds((current) =>
        current.includes(variables.streamId) ? current : [...current, variables.streamId]
      )
      toast.info('Запускаємо трансляцію...')
    },
    onSuccess: (_, variables) => {
      toast.success(streamingToasts('stream.started'))
      queryClient.invalidateQueries({ queryKey: ['stream-status', user?.id, variables.streamId] })
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
    },
    onError: (error: Error & { quality?: StreamQualityResponse }, variables) => {
      if (variables?.streamId) {
        setOptimisticRunningStreamIds((current) => current.filter((id) => id !== variables.streamId))
      }
      if (error.quality && !error.quality.ok) {
        openQualityGate({ streamName: variables?.streamName, quality: error.quality })
        return
      }

      if (error instanceof ApiError) {
        const detail = error.detail as
          | {
              error?: string
              resource?: string
              current?: number
              limit?: number
              message?: string
            }
          | undefined

        if (detail?.error === 'quota_exceeded') {
          if (detail.resource === 'concurrent streams') {
            const rawCurrent =
              typeof detail.current === 'number'
                ? detail.current
                : typeof (detail as { count?: number }).count === 'number'
                  ? (detail as { count?: number }).count
                  : undefined
            const rawLimit = typeof detail.limit === 'number' ? detail.limit : undefined

            toast.error(
              streamingToasts('errors.concurrentLimit', {
                current: rawCurrent ?? '?',
                limit: rawLimit ?? '?',
              }),
            )
            return
          }

          if (typeof detail.message === 'string' && detail.message.trim()) {
            toast.error(streamingToasts('generic.errorWithMessage', { message: detail.message }))
            return
          }
        }

        if (typeof detail?.message === 'string' && detail.message.trim()) {
          toast.error(streamingToasts('generic.errorWithMessage', { message: detail.message }))
          return
        }
      }

      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const stopStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.stop(streamId),
    onMutate: (streamId) => {
      setActiveStreamTab('live')
      setOptimisticStoppingStreamIds((current) =>
        current.includes(streamId) ? current : [...current, streamId]
      )
    },
    onSuccess: (_, streamId) => {
      toast.info(streamingToasts('stream.stopped'))
      setOptimisticRunningStreamIds((current) => current.filter((id) => id !== streamId))
      queryClient.invalidateQueries({ queryKey: ['stream-status', user?.id, streamId] })
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
    },
    onError: (error: Error, streamId) => {
      setOptimisticStoppingStreamIds((current) => current.filter((id) => id !== streamId))
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message }))
    },
    onSettled: (_, __, streamId) => {
      setOptimisticStoppingStreamIds((current) => current.filter((id) => id !== streamId))
    },
  })

  const deleteStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.delete(streamId),
    onSuccess: (_, streamId) => {
      toast.success(streamingToasts('stream.deleted'))
      if (viewingLogs === streamId) {
        setViewingLogs(null)
      }
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const resetChannelForm = () => {
    setChannelForm({
      name: '',
      rtmps_url: 'rtmps://a.rtmp.youtube.com/live2',
      stream_key: '',
      enabled: true,
      provider_connection_id: null,
    })
    setEditingChannelId(null)
    setShowChannelForm(false)
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
      provider_connection_id: destination.provider_connection_id ?? null,
    })
    setShowChannelForm(true)
  }

  const primeStreamEditorDrafts = (stream: Stream) => {
    setLiveEditorScheduleDraft({
      startMode: stream.scheduled_start_enabled ? 'schedule' : 'now',
      startAt: stream.scheduled_start_time ? formatDateTimeLocal(new Date(stream.scheduled_start_time)) : '',
      stopAt: stream.scheduled_stop_time ? formatDateTimeLocal(new Date(stream.scheduled_stop_time)) : '',
    })
    setLiveEditorNameDraft(stream.name ?? '')
    setLiveEditorDestinationIds((stream.destinations ?? []).map((destination) => destination.id))
  }

  const handleOpenStreamEditor = (stream: Stream) => {
    primeStreamEditorDrafts(stream)
    openLiveEditor(stream)
  }

  const handleDeleteChannel = (destinationId: string) => {
    if (confirm(tStreaming('channels.form.confirmDelete'))) {
      deleteDestinationMutation.mutate(destinationId)
    }
  }

  const handleStartYouTubeConnect = async () => {
    try {
      const redirect_origin = window.location.origin
      const redirect_path = '/dashboard/streaming'
      const response = await api.youtube.oauthStart({ redirect_origin, redirect_path })
      window.location.href = response.auth_url
    } catch (error) {
      const message = error instanceof Error ? error.message : tStreaming('provider.oauth.startFailed')
      toast.error(streamingToasts('generic.errorWithMessage', { message }))
    }
  }

  const handleStartStream = (stream: Stream) =>
    startStreamMutation.mutate({
      streamId: stream.id,
      streamName: stream.name,
    })

  const handleStopStream = (streamId: string) => stopStreamMutation.mutate(streamId)
  const handleDeleteStream = (stream: Stream) => {
    const confirmed = window.confirm(
      `${tStreaming('streams.deleteConfirm.title')}\n\n${tStreaming('streams.deleteConfirm.description', {
        name: stream.name || tStreaming('streams.untitled'),
      })}`,
    )

    if (!confirmed) {
      return
    }

    deleteStreamMutation.mutate(stream.id)
  }
  const handleCloseLiveEditor = () => {
    setLiveEditorScheduleDraft(null)
    setLiveEditorNameDraft('')
    setLiveEditorDestinationIds([])
    closeLiveEditor()
  }
  const handleLiveEditorDestinationToggle = (destinationId: string) => {
    setLiveEditorDestinationIds((current) =>
      current.includes(destinationId)
        ? current.filter((id) => id !== destinationId)
        : [...current, destinationId],
    )
  }
  const handleApplyLiveEditorChanges = async () => {
    const contentUpdated = await applyLiveEditorChanges()
    if (!contentUpdated || !liveEditingStream || !liveEditorScheduleDraft) return

    if (liveEditorScheduleDraft.startMode === 'schedule' && !liveEditorScheduleDraft.startAt) {
      toast.error(streamingToasts('errors.scheduleTime'))
      return
    }

    const now = new Date()
    const startAtIso =
      liveEditorScheduleDraft.startMode === 'schedule' && liveEditorScheduleDraft.startAt
        ? new Date(liveEditorScheduleDraft.startAt).toISOString()
        : null
    const stopAtIso = liveEditorScheduleDraft.stopAt ? new Date(liveEditorScheduleDraft.stopAt).toISOString() : null

    if (liveEditorScheduleDraft.stopAt) {
      const stopAt = new Date(liveEditorScheduleDraft.stopAt)
      if (Number.isNaN(stopAt.getTime()) || stopAt <= now) {
        toast.error(streamingToasts('errors.scheduleStopTime'))
        return
      }
      if (liveEditorScheduleDraft.startMode === 'schedule' && liveEditorScheduleDraft.startAt) {
        const startAt = new Date(liveEditorScheduleDraft.startAt)
        if (stopAt <= startAt) {
          toast.error(streamingToasts('errors.scheduleStopAfterStart'))
          return
        }
      }
    }

    if (liveEditorDestinationIds.length === 0) {
      toast.error(streamingToasts('errors.selectDestination'))
      return
    }

    await updateScheduleMutation.mutateAsync({
      streamId: liveEditingStream.id,
      payload: {
        name: liveEditorNameDraft.trim() || null,
        destination_ids: liveEditorDestinationIds,
        schedule_mode: liveEditorScheduleDraft.startMode,
        schedule_start_at: startAtIso,
        schedule_stop_at: stopAtIso,
      },
    })
  }
  const pendingStartStreamId = startStreamMutation.isPending ? startStreamMutation.variables?.streamId ?? null : null
  const pendingStopStreamId = stopStreamMutation.isPending ? stopStreamMutation.variables ?? null : null
  const pendingDeleteStreamId = deleteStreamMutation.isPending ? deleteStreamMutation.variables ?? null : null

  const { data: logsResponse } = useQuery<StreamLogsResponse>({
    queryKey: ['stream-logs', user?.id, viewingLogs, logsMode],
    queryFn: () => api.streams.logs(viewingLogs!, { lines: 200, mode: logsMode }),
    enabled: !!viewingLogs,
    refetchInterval: 2000,
  })
  const stopAuditEntries = useMemo(
    () => extractStopAuditEntries(logsResponse?.logs ?? []).slice(-4).reverse(),
    [logsResponse?.logs],
  )

  const {
    liveEditingStream,
    liveEditorState,
    liveEditorLoading,
    liveEditorQueueing,
    liveEditorApplying,
    canApplyLiveEditorChanges,
    openLiveEditor,
    closeLiveEditor,
    addAssetToLiveEditor,
    removeLiveEditorItem,
    moveLiveEditorItem,
    toggleLiveEditorOption,
    applyLiveEditorChanges,
    assetMap: liveEditorAssetMap,
    videoAssets: liveEditorVideoAssets,
    audioAssets: liveEditorAudioAssets,
  } = useLiveEditor({ assets, tStreaming, streamingToasts })

  useEffect(() => {
    const targetId = searchParams?.get('editStream') ?? searchParams?.get('editSchedule')
    if (!targetId || !streams?.length) return
    const match = streams.find((stream) => stream.id === targetId)
    if (!match) return
    primeStreamEditorDrafts(match)
    openLiveEditor(match)
    router.replace('/dashboard/streaming', { scroll: false })
  }, [openLiveEditor, router, searchParams, streams])

  const presentedStreams = useMemo(
    () =>
      (streams ?? []).map((stream) => ({
        stream,
        derived: deriveStreamState(stream, liveStatusMap.get(stream.id)),
      })),
    [liveStatusMap, streams],
  )

  const liveEntries = useMemo(
    () =>
      presentedStreams.filter(
        ({ stream, derived }) =>
          optimisticRunningStreamIds.includes(stream.id) ||
          optimisticStoppingStreamIds.includes(stream.id) ||
          derived.isRunning ||
          derived.group === 'transitioning',
      ),
    [optimisticRunningStreamIds, optimisticStoppingStreamIds, presentedStreams],
  )
  const runningStreams = useMemo(
    () =>
      presentedStreams
        .filter(
          ({ stream, derived }) =>
            optimisticRunningStreamIds.includes(stream.id) ||
            derived.isRunning,
        )
        .map(({ stream }) => stream),
    [optimisticRunningStreamIds, presentedStreams],
  )
  const scheduledEntries = useMemo(
    () => presentedStreams.filter(({ derived }) => derived.group === 'scheduled'),
    [presentedStreams],
  )
  const archiveEntries = useMemo(
    () =>
      presentedStreams.filter(
        ({ stream, derived }) =>
          (derived.group === 'stopped' || derived.group === 'attention') &&
          !optimisticRunningStreamIds.includes(stream.id) &&
          !optimisticStoppingStreamIds.includes(stream.id),
      ),
    [optimisticRunningStreamIds, optimisticStoppingStreamIds, presentedStreams],
  )
  const degradedLiveEntries = useMemo(
    () =>
      liveEntries.filter(({ derived }) => derived.isDegraded),
    [liveEntries],
  )
  const viewingStreamEntry = useMemo(
    () =>
      viewingLogs
        ? presentedStreams.find(({ stream }) => stream.id === viewingLogs) ?? null
        : null,
    [presentedStreams, viewingLogs],
  )
  const logIncidentSummary = useMemo(
    () => summarizeStreamLogIncidents(logsResponse?.logs ?? []),
    [logsResponse?.logs],
  )
  const runtimeIncidentNotice = useMemo(
    () => buildStreamIncidentNotice(viewingStreamEntry?.derived.incidentSummary),
    [viewingStreamEntry],
  )
  const logIncidentNotice = useMemo(
    () => buildStreamIncidentNotice(logIncidentSummary),
    [logIncidentSummary],
  )

  if (!user) {
    return <LoadingState text={tStreaming('loading')} />
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="page-title">{tStreaming('header.title')}</div>
          <div className="page-sub">{tStreaming('header.description')}</div>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowCreateStream(true)} className="flex items-center gap-2">
            <Play className="w-4 h-4" />
            <span>📡 Нова трансляція</span>
          </Button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-strip-card">
          <div style={{ fontSize: 24 }}>🔴</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{runningStreams.length}</div>
            <div className="page-sub">Активних ефірів</div>
          </div>
        </div>
        <div className="stat-strip-card">
          <div style={{ fontSize: 24 }}>📊</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {runningStreams.length}/{formatLimitValue(concurrentStreamsLimit)}
            </div>
            <div className="page-sub">Паралельний ліміт</div>
          </div>
        </div>
        <div className="stat-strip-card">
          <div style={{ fontSize: 24 }}>📡</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {destinations?.length || 0}/{formatLimitValue(destinationsLimit)}
            </div>
            <div className="page-sub">Каналів додано</div>
          </div>
        </div>
        <div className="stat-strip-card">
          <div style={{ fontSize: 24 }}>⚠️</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--amber)' }}>{degradedLiveEntries.length}</div>
            <div className="page-sub">Деградуючих ефірів</div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="mb-4 flex-row items-center justify-between">
          <div>
            <CardTitle>📡 Канали (RTMPS)</CardTitle>
            <div className="page-sub" style={{ marginTop: 4 }}>
              {tStreaming('provider.channelsDescription')}
            </div>
          </div>
          <Button size="sm" onClick={() => setShowChannelForm(true)}>+ Додати канал</Button>
        </CardHeader>
        <CardContent className="channels-list">
          {isLoadingDestinations ? (
            <LoadingState />
          ) : destinations && destinations.length > 0 ? (
            destinations.map((destination) => {
              const platform = getDestinationPlatformPresentation(destination)
              return (
              <div
                key={destination.id}
                className={`channel-row${selectedChannel === destination.id ? ' active' : ''}`}
                onClick={() => setSelectedChannel(destination.id)}
                role="button"
                tabIndex={0}
              >
                <div className={platform.className} aria-label={platform.label}>{platform.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{destination.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
                    {destination.rtmps_url} · Ключ: {destination.stream_key_masked}
                  </div>
                  {formatProviderSummary(destination) ? (
                    <div style={{ fontSize: 12, color: 'var(--txt-2)', marginTop: 4 }}>
                      {formatProviderSummary(destination)}
                    </div>
                  ) : null}
                </div>
                <Badge variant={destination.enabled ? 'live' : 'idle'}>
                  {destination.enabled ? 'Активний' : 'Не використовується'}
                </Badge>
                {shouldShowProviderBadge(destination) ? (
                  <Badge variant={getProviderBadgeVariant(destination.provider_status)}>
                    {formatProviderStatus(destination.provider_status)}
                  </Badge>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation()
                    handleEditChannel(destination)
                  }}
                >
                  Ред.
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={(event) => {
                    event.stopPropagation()
                    handleDeleteChannel(destination.id)
                  }}
                >
                  Видалити
                </Button>
              </div>
              )
            })
          ) : (
            <div className="empty-state" style={{ padding: '32px 12px' }}>
              <div className="empty-icon">📡</div>
              <div className="empty-title">Ще немає каналів</div>
              <div className="empty-sub">{tStreaming('provider.channelsEmpty')}</div>
              <Button size="sm" variant="outline" onClick={() => setShowChannelForm(true)} style={{ marginTop: 12 }}>
                + Додати канал
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="tabs" role="tablist" aria-label="Потоки">
        <button
          type="button"
          role="tab"
          aria-selected={activeStreamTab === 'live'}
          className={`tab-btn ${activeStreamTab === 'live' ? 'active' : ''}`}
          onClick={() => setActiveStreamTab('live')}
        >
          <span className="tab-btn-label">🔴 У ефірі</span>
          {liveEntries.length ? <span className="tab-badge">{liveEntries.length}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeStreamTab === 'scheduled'}
          className={`tab-btn ${activeStreamTab === 'scheduled' ? 'active' : ''}`}
          onClick={() => setActiveStreamTab('scheduled')}
        >
          <span className="tab-btn-label">🗓️ Заплановані</span>
          {scheduledEntries.length ? <span className="tab-badge tab-badge-active">{scheduledEntries.length}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeStreamTab === 'archive'}
          className={`tab-btn ${activeStreamTab === 'archive' ? 'active' : ''}`}
          onClick={() => setActiveStreamTab('archive')}
        >
          <span className="tab-btn-label">📋 Архів</span>
          {archiveEntries.length ? <span className="tab-badge tab-badge-muted">{archiveEntries.length}</span> : null}
        </button>
      </div>

      {activeStreamTab === 'live' ? (
        <div className="summary-list">
          {liveEntries.length > 0 ? liveEntries.map(({ stream, derived }) => {
            const sourceName = getStreamSourceLabel(stream)
            const sourceTotalSeconds = getStreamSourceTotalSeconds(stream)
            const destinationLabel = (stream.destinations ?? []).map((d) => d.name).join(', ') || 'Канал не вказано'
            const quotaLabel = derived.quotaReached
              ? '0'
              : formatLimitValue(derived.remainingDailySeconds ?? null)
            const isOptimisticallyStarting = pendingStartStreamId === stream.id || (optimisticRunningStreamIds.includes(stream.id) && !derived.isRunning)
            const isOptimisticallyStopping = pendingStopStreamId === stream.id || optimisticStoppingStreamIds.includes(stream.id) || derived.isStopping
            const isTransitioning = isOptimisticallyStarting || isOptimisticallyStopping || derived.isTransitioning
            const incidentNotice = buildStreamIncidentNotice(derived.incidentSummary)
            const statusLabel = isOptimisticallyStopping
              ? 'Зупиняється'
              : isOptimisticallyStarting || derived.isStarting
                ? 'Запускається'
                : derived.isDegraded
                  ? 'ДЕГРАДУЄ'
                  : 'У ЕФІРІ'
            const progressPercent = sourceTotalSeconds && derived.liveDurationSeconds != null
              ? Math.min(100, Math.round((derived.liveDurationSeconds / sourceTotalSeconds) * 100))
              : null

            return (
              <article
                key={stream.id}
                className="card stream-summary-card"
                style={{
                  borderColor: isTransitioning
                    ? 'rgba(245,158,11,.35)'
                    : derived.isDegraded
                      ? 'rgba(245,158,11,.35)'
                      : 'rgba(34,197,94,.25)',
                }}
              >
                <div className="card-content">
                  <div className="stream-card-header">
                    <Badge variant={isTransitioning || derived.isDegraded ? 'warn' : 'live'} style={{ fontSize: 12 }}>
                      {isTransitioning ? null : <span className="live-dot" />}{statusLabel}
                    </Badge>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{stream.name || 'Без назви'}</span>
                    <span className="page-sub ml-auto">{destinationLabel} · {derived.isRunning && stream.started_at ? `Розпочато ${new Date(stream.started_at).toLocaleTimeString()}` : statusLabel}</span>
                    <Button size="sm" variant="danger" onClick={() => handleStopStream(stream.id)} disabled={isTransitioning}>
                      {isOptimisticallyStopping ? '⏳ Зупиняється' : isOptimisticallyStarting || derived.isStarting ? '⏳ Запускається' : '■ Зупинити'}
                    </Button>
                  </div>

                  {incidentNotice ? (
                    <div
                      className="rounded-lg border px-4 py-3 text-sm"
                      style={{
                        marginTop: 12,
                        borderColor:
                          incidentNotice.tone === 'critical'
                            ? 'rgba(248,113,113,.35)'
                            : 'rgba(245,158,11,.35)',
                        background:
                          incidentNotice.tone === 'critical'
                            ? 'rgba(127,29,29,.18)'
                            : 'rgba(120,53,15,.18)',
                        color: 'var(--txt)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '.08em',
                          color: incidentNotice.tone === 'critical' ? '#fecaca' : '#fde68a',
                        }}
                      >
                        {incidentNotice.tone === 'critical' ? 'Критичний інцидент' : 'Потік деградує'}
                      </div>
                      <div style={{ marginTop: 6, fontWeight: 600 }}>{incidentNotice.title}</div>
                      {incidentNotice.details.length ? (
                        <div style={{ marginTop: 6, color: 'var(--txt-2)' }}>
                          {incidentNotice.details.join(' · ')}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="stream-playback-panel">
                    <div className="flex items-center gap-8 mb-10">
                      <span style={{ fontSize: 18 }}>🎬</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--txt-3)' }}>
                          Відеоряд (зараз програється)
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{sourceName}</div>
                      </div>
                      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>Прогрес файлу</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: progressPercent == null ? 'var(--txt-2)' : 'var(--green)' }}>
                          {progressPercent == null ? '—' : `${progressPercent}%`}
                        </div>
                      </div>
                    </div>
                    <div className="progress-bar" style={{ height: 6 }}>
                      <div className="progress-fill green" style={{ width: `${progressPercent ?? 0}%` }} />
                    </div>
                    <div className="flex items-center gap-8 mt-6">
                      <span className="page-sub">{progressPercent == null ? 'Прогрес буде доступний після старту' : `${progressPercent}% відтворено`}</span>
                      <Badge variant="indigo" style={{ fontSize: 10, marginLeft: 'auto' }}>🔄 Цикл увімк.</Badge>
                    </div>
                  </div>

                  <div className="stream-metrics-grid">
                    <div className="stream-metric-tile">
                      <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>
                        {formatDuration(Math.round(derived.totalDurationSeconds ?? 0))}
                      </div>
                      <div className="page-sub">Загальна тривалість</div>
                    </div>
                    <div className="stream-metric-tile">
                      <div style={{ fontSize: 15, fontWeight: 700 }}>
                        {sourceTotalSeconds ? formatDuration(Math.round(sourceTotalSeconds)) : '—'}
                      </div>
                      <div className="page-sub">Відеоряд всього</div>
                    </div>
                    <div className="stream-metric-tile">
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--amber)' }}>{quotaLabel}</div>
                      <div className="page-sub">Залишок ліміту</div>
                    </div>
                    <div className="stream-metric-tile">
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{planQualityLimits?.max_resolution ?? activePlanLabel}</div>
                      <div className="page-sub">Якість потоку</div>
                    </div>
                  </div>

                  <div className="page-actions" style={{ marginTop: 14, marginLeft: 0 }}>
                    <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(stream.provider_video_id ? `https://www.youtube.com/watch?v=${stream.provider_video_id}` : window.location.href)}>🔗 Посилання</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setLogsMode('important'); setViewingLogs(stream.id) }}>📋 Лог</Button>
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => openLiveEditor(stream)}>Більше дій ▾</Button>
                  </div>
                </div>
              </article>
            )
          }) : (
            <Card>
              <CardContent>
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-icon">📡</div>
                  <div className="empty-title">Активних трансляцій немає</div>
                  <div className="empty-sub">Створіть трансляцію, щоб керувати нею тут.</div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}

      {activeStreamTab === 'scheduled' ? (
        <Card>
          <CardHeader><CardTitle>🗓️ Заплановані</CardTitle></CardHeader>
          <CardContent className="summary-list">
            {scheduledEntries.length > 0 ? scheduledEntries.map(({ stream }) => (
              <div key={stream.id} className="stream-row">
                <div className="stream-thumb">🗓️</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{stream.name || 'Без назви'}</div>
                  <div className="page-sub">{stream.scheduled_start_time ? new Date(stream.scheduled_start_time).toLocaleString() : 'Заплановано'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Button size="sm" onClick={() => handleStartStream(stream)} disabled={pendingStartStreamId === stream.id}>
                    {pendingStartStreamId === stream.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '▶ Запустити'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleOpenStreamEditor(stream)}>✏️ Редагувати</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setLogsMode('important'); setViewingLogs(stream.id) }}>📋 Лог</Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleDeleteStream(stream)}
                    disabled={pendingDeleteStreamId === stream.id}
                  >
                    {pendingDeleteStreamId === stream.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      `🗑 ${tStreaming('streams.buttons.delete')}`
                    )}
                  </Button>
                </div>
              </div>
            )) : (
              <div className="empty-state" style={{ padding: '36px 20px' }}>
                <div className="empty-icon">🗓️</div>
                <div className="empty-title">Немає запланованих трансляцій</div>
                <div className="empty-sub">Оберіть запланований старт у вікні створення трансляції.</div>
                <Button size="sm" variant="outline" onClick={() => setShowCreateStream(true)} style={{ marginTop: 12 }}>
                  + Запланувати стрім
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeStreamTab === 'archive' ? (
        <Card>
          <CardHeader><CardTitle>📋 Архів</CardTitle></CardHeader>
          <CardContent className="table-wrap">
            {archiveEntries.length > 0 ? (
              <table className="table">
                <thead>
                  <tr><th>Назва</th><th>Джерело</th><th>Канал</th><th>Дата</th><th>Дії</th></tr>
                </thead>
                <tbody>
                  {archiveEntries.map(({ stream }) => (
                    <tr key={stream.id}>
                      <td>{stream.name || 'Без назви'}</td>
                      <td>{getStreamSourceLabel(stream)}</td>
                      <td>{(stream.destinations ?? []).map((d) => d.name).join(', ') || '—'}</td>
                      <td>{new Date(stream.created_at).toLocaleString()}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <Button size="sm" onClick={() => handleStartStream(stream)} disabled={pendingStartStreamId === stream.id}>
                            {pendingStartStreamId === stream.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '▶ Запустити'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleOpenStreamEditor(stream)}>✏️ Редагувати</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setLogsMode('important'); setViewingLogs(stream.id) }}>📋 Лог</Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDeleteStream(stream)}
                            disabled={pendingDeleteStreamId === stream.id}
                          >
                            {pendingDeleteStreamId === stream.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              `🗑 ${tStreaming('streams.buttons.delete')}`
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-state" style={{ padding: '36px 20px' }}>
                <div className="empty-icon">📋</div>
                <div className="empty-title">Архів поки порожній</div>
                <div className="empty-sub">Після зупинки ефірів тут з’явиться історія трансляцій і доступ до логів.</div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <AddChannelModal
        open={showChannelForm}
        editingChannelId={editingChannelId}
        channelForm={channelForm}
        youtubeConnections={youtubeConnections}
        onChange={setChannelForm}
        onSubmit={handleSubmitChannel}
        onCancel={resetChannelForm}
        onStartYouTubeConnect={handleStartYouTubeConnect}
        isSaving={createDestinationMutation.isPending || updateDestinationMutation.isPending}
        t={tStreaming}
      />

      <StreamBuilderModal
        open={showCreateStream}
        onClose={() => setShowCreateStream(false)}
        onOpenChannelForm={() => setShowChannelForm(true)}
        destinations={destinations}
        isLoadingDestinations={isLoadingDestinations}
        assets={assets}
        isLoadingAssets={isLoadingAssets}
        videoCollections={videoCollections}
        isLoadingVideoCollections={isLoadingVideoCollections}
        audioCollections={audioCollections}
        isLoadingAudioCollections={isLoadingAudioCollections}
        quota={quota}
        streams={streams}
        t={tStreaming}
        streamingToasts={streamingToasts}
        formatLimitValue={formatLimitValue}
      />

      {viewingLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-4xl animate-scale-in">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{tStreaming('streams.logs.title')}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setLogsMode(logsMode === 'important' ? 'raw' : 'important')}
                  >
                    {logsMode === 'important'
                      ? tStreaming('streams.logs.showAll')
                      : tStreaming('streams.logs.showImportant')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setViewingLogs(null)
                      setLogsMode('important')
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {stopAuditEntries.length ? (
                <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-50">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
                    {tStreaming('streams.logs.stopAuditTitle')}
                  </div>
                  <div className="space-y-2">
                    {stopAuditEntries.map((entry) => (
                      <div
                        key={`${entry.timestamp ?? 'unknown'}-${entry.message}`}
                        className="rounded-md border border-white/10 bg-slate-950/30 px-3 py-2"
                      >
                        <div className="text-[11px] uppercase tracking-[0.08em] text-amber-200/80">
                          {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : tStreaming('streams.logs.unknownTime')}
                        </div>
                        <div className="mt-1 text-sm font-medium text-white">{entry.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {runtimeIncidentNotice ? (
                <div
                  className="rounded-lg border p-4 text-sm"
                  style={{
                    borderColor:
                      runtimeIncidentNotice.tone === 'critical'
                        ? 'rgba(248,113,113,.35)'
                        : 'rgba(245,158,11,.35)',
                    background:
                      runtimeIncidentNotice.tone === 'critical'
                        ? 'rgba(127,29,29,.18)'
                        : 'rgba(120,53,15,.18)',
                    color: 'var(--txt)',
                  }}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.12em]">
                    Поточний runtime-контекст
                  </div>
                  <div className="mt-2 text-sm font-medium">{runtimeIncidentNotice.title}</div>
                  {runtimeIncidentNotice.details.length ? (
                    <div className="mt-2 text-xs text-slate-200">{runtimeIncidentNotice.details.join(' · ')}</div>
                  ) : null}
                </div>
              ) : null}
              {logIncidentNotice ? (
                <div
                  className="rounded-lg border p-4 text-sm"
                  style={{
                    borderColor:
                      logIncidentNotice.tone === 'critical'
                        ? 'rgba(248,113,113,.35)'
                        : 'rgba(245,158,11,.35)',
                    background:
                      logIncidentNotice.tone === 'critical'
                        ? 'rgba(127,29,29,.18)'
                        : 'rgba(120,53,15,.18)',
                    color: 'var(--txt)',
                  }}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.12em]">
                    Incident digest з логів
                  </div>
                  <div className="mt-2 text-sm font-medium">{logIncidentNotice.title}</div>
                  {logIncidentNotice.details.length ? (
                    <div className="mt-2 space-y-1 text-xs text-slate-200">
                      {logIncidentNotice.details.map((detail) => (
                        <div key={detail}>{detail}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="bg-slate-900 text-slate-100 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
                {logsResponse?.logs?.length ? (
                  logsResponse.logs.map((line, index) => (
                    <p key={index} className={getStreamLogLineClassName(line)}>
                      {line}
                    </p>
                  ))
                ) : (
                  <p className="text-slate-300">
                    {logsMode === 'important'
                      ? tStreaming('streams.logs.emptyImportant')
                      : tStreaming('streams.logs.empty')}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <LiveEditorModal
        stream={liveEditingStream}
        isLoading={liveEditorLoading}
        applying={liveEditorApplying}
        queueing={liveEditorQueueing}
        canApply={canApplyLiveEditorChanges}
        state={liveEditorState}
        assetMap={liveEditorAssetMap}
        videoAssets={liveEditorVideoAssets}
        audioAssets={liveEditorAudioAssets}
        onClose={handleCloseLiveEditor}
        onApply={handleApplyLiveEditorChanges}
        scheduleDraft={liveEditorScheduleDraft}
        onScheduleChange={setLiveEditorScheduleDraft}
        nameDraft={liveEditorNameDraft}
        onNameChange={setLiveEditorNameDraft}
        destinations={destinations}
        selectedDestinationIds={liveEditorDestinationIds}
        onDestinationToggle={handleLiveEditorDestinationToggle}
        onAddAsset={addAssetToLiveEditor}
        onRemoveItem={removeLiveEditorItem}
        onMoveItem={moveLiveEditorItem}
        onToggleOption={toggleLiveEditorOption}
        t={tStreaming}
      />

      <QualityGateModal
        state={qualityGate}
        groupedViolations={groupedViolations}
        activePlanLabel={activePlanLabel}
        planQualityLimits={planQualityLimits}
        t={tStreaming}
        onClose={closeQualityGate}
        onGoToLibrary={() => router.push('/dashboard/library')}
      />
    </div>
  )
}
