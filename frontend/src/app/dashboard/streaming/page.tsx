'use client'
/* eslint-disable i18next/no-literal-string */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Play, Loader2, X, Info, ChevronDown } from 'lucide-react'
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
import { StreamScheduleModal } from './components/StreamScheduleModal'
import { useLiveEditor } from './hooks/useLiveEditor'
import { useQualityGate } from './hooks/useQualityGate'
import { useStreamStatusMap } from './hooks/useStreamStatusMap'
import { AddChannelModal } from '@/components/streaming/AddChannelModal'
import { deriveStreamState } from '@/lib/stream-state'
import {
  getProviderStatusKey,
  getProviderBadgeVariant,
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
  const [scheduleModalStream, setScheduleModalStream] = useState<Stream | null>(null)
  const [activeStreamTab, setActiveStreamTab] = useState<'live' | 'scheduled' | 'archive'>('live')
  const [optimisticRunningStreamIds, setOptimisticRunningStreamIds] = useState<string[]>([])

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

  useEffect(() => {
    const targetId = searchParams?.get('editSchedule')
    if (!targetId || !streams?.length) return
    const match = streams.find((stream) => stream.id === targetId)
    if (!match) return
    setScheduleModalStream(match)
    router.replace('/dashboard/streaming', { scroll: false })
  }, [router, searchParams, streams])

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
    const primaryDestinationUrl = stream.destinations?.[0]?.rtmps_url?.trim()
    if (primaryDestinationUrl) {
      const normalizedUrl = primaryDestinationUrl.toLowerCase()
      if (normalizedUrl.includes('youtube.com')) return 'YouTube'
      return 'RTMPS'
    }
    if (stream.playlist_id) return playlistMap.get(stream.playlist_id)?.name ?? 'Плейлист'
    if (stream.stream_assets?.length) return `Черга (${stream.stream_assets.length})`
    return 'YouTube'
  }
  const formatProviderSummary = (destination: Destination) => {
    if (!destination.provider_connection_id) return null
    if (!destination.provider_viewers && (!destination.provider_status || destination.provider_status === 'unknown')) return null
    const base = formatProviderStatus(destination.provider_status)
    if (typeof destination.provider_viewers === 'number') {
      return `${base} · ${tStreaming('provider.viewers', { count: destination.provider_viewers })}`
    }
    return base
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
      setScheduleModalStream(null)
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
    onSuccess: (_, streamId) => {
      toast.info(streamingToasts('stream.stopped'))
      setOptimisticRunningStreamIds((current) => current.filter((id) => id !== streamId))
      queryClient.invalidateQueries({ queryKey: ['stream-status', user?.id, streamId] })
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
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

  const handleOpenSchedule = (stream: Stream) => {
    setScheduleModalStream(stream)
  }

  const handleSaveSchedule = (draft: { startMode: 'now' | 'schedule'; startAt: string; stopAt: string }) => {
    if (!scheduleModalStream) return

    if (draft.startMode === 'schedule' && !draft.startAt) {
      toast.error(streamingToasts('errors.scheduleTime'))
      return
    }

    const now = new Date()
    const startAtIso =
      draft.startMode === 'schedule' && draft.startAt ? new Date(draft.startAt).toISOString() : null
    const stopAtIso = draft.stopAt ? new Date(draft.stopAt).toISOString() : null

    if (draft.stopAt) {
      const stopAt = new Date(draft.stopAt)
      if (Number.isNaN(stopAt.getTime()) || stopAt <= now) {
        toast.error(streamingToasts('errors.scheduleStopTime'))
        return
      }
      if (draft.startMode === 'schedule' && draft.startAt) {
        const startAt = new Date(draft.startAt)
        if (stopAt <= startAt) {
          toast.error(streamingToasts('errors.scheduleStopAfterStart'))
          return
        }
      }
    }

    updateScheduleMutation.mutate({
      streamId: scheduleModalStream.id,
      payload: {
        schedule_mode: draft.startMode,
        schedule_start_at: startAtIso,
        schedule_stop_at: stopAtIso,
      },
    })
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
  const handleDeleteStream = (streamId: string) => deleteStreamMutation.mutate(streamId)
  const pendingStartStreamId = startStreamMutation.isPending ? startStreamMutation.variables?.streamId ?? null : null
  const pendingStopStreamId = stopStreamMutation.isPending ? stopStreamMutation.variables ?? null : null
  const pendingDeleteStreamId = deleteStreamMutation.isPending ? deleteStreamMutation.variables ?? null : null

  const { data: logsResponse } = useQuery<StreamLogsResponse>({
    queryKey: ['stream-logs', user?.id, viewingLogs, logsMode],
    queryFn: () => api.streams.logs(viewingLogs!, { lines: 200, mode: logsMode }),
    enabled: !!viewingLogs,
    refetchInterval: 2000,
  })

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
          derived.isRunning ||
          derived.group === 'attention',
      ),
    [optimisticRunningStreamIds, presentedStreams],
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
          derived.group === 'stopped' && !optimisticRunningStreamIds.includes(stream.id),
      ),
    [optimisticRunningStreamIds, presentedStreams],
  )
  const readyEntries = archiveEntries

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
            destinations.map((destination) => (
              <div
                key={destination.id}
                className={`channel-row${selectedChannel === destination.id ? ' active' : ''}`}
                onClick={() => setSelectedChannel(destination.id)}
                role="button"
                tabIndex={0}
              >
                <div className="channel-logo">{destination.name.toLowerCase().includes('twitch') ? '🎮' : '▶'}</div>
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
            ))
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

      <div className="tabs">
        <button type="button" className={`tab-btn ${activeStreamTab === 'live' ? 'active' : ''}`} onClick={() => setActiveStreamTab('live')}>
          🔴 У ефірі
          {liveEntries.length ? <span className="nav-badge" style={{ marginLeft: 6 }}>{liveEntries.length}</span> : null}
        </button>
        <button type="button" className={`tab-btn ${activeStreamTab === 'scheduled' ? 'active' : ''}`} onClick={() => setActiveStreamTab('scheduled')}>
          🗓️ Заплановані
          {scheduledEntries.length ? <span className="nav-badge" style={{ marginLeft: 6, background: 'var(--indigo)' }}>{scheduledEntries.length}</span> : null}
        </button>
        <button type="button" className={`tab-btn ${activeStreamTab === 'archive' ? 'active' : ''}`} onClick={() => setActiveStreamTab('archive')}>
          📋 Архів
          {archiveEntries.length ? <span className="nav-badge" style={{ marginLeft: 6, background: 'var(--bg-3)', color: 'var(--txt-2)' }}>{archiveEntries.length}</span> : null}
        </button>
      </div>

      {activeStreamTab === 'live' ? (
        <div className="summary-list">
          {liveEntries.length > 0 ? liveEntries.map(({ stream, derived }) => {
            const sourceName = getStreamSourceLabel(stream)
            const destinationLabel = (stream.destinations ?? []).map((d) => d.name).join(', ') || 'Канал не вказано'
            const quotaLabel = derived.quotaReached
              ? '0'
              : formatLimitValue(derived.remainingDailySeconds ?? null)
            const isOptimisticallyStarting = pendingStartStreamId === stream.id || (optimisticRunningStreamIds.includes(stream.id) && !derived.isRunning)

            return (
              <article key={stream.id} className="card stream-summary-card" style={{ borderColor: 'rgba(34,197,94,.25)' }}>
                <div className="card-content">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <Badge variant={isOptimisticallyStarting ? 'warn' : 'live'}>
                      {isOptimisticallyStarting ? 'Запускається' : 'У ЕФІРІ'}
                    </Badge>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{stream.name || 'Без назви'}</span>
                    <span className="page-sub" style={{ marginLeft: 'auto' }}>{destinationLabel}</span>
                    <Button size="sm" variant="danger" onClick={() => handleStopStream(stream.id)} disabled={isOptimisticallyStarting}>
                      {isOptimisticallyStarting ? '⏳ Запускається' : '■ Зупинити'}
                    </Button>
                  </div>

                  <div className="stream-row active" style={{ marginBottom: 14 }}>
                    <div className="stream-thumb">🎬</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--txt-3)' }}>
                        Відеоряд / джерело
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{sourceName}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {hasProviderConnection(stream) && stream.provider_viewers != null ? (
                        <>
                          <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{tStreaming('provider.viewersLabel')}</div>
                          <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>
                            {stream.provider_viewers}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: hasProviderConnection(stream) && stream.provider_viewers != null ? 'repeat(4,1fr)' : 'repeat(3,1fr)', gap: 10 }}>
                    {hasProviderConnection(stream) && stream.provider_viewers != null ? (
                      <div className="stream-row" style={{ justifyContent: 'center', textAlign: 'center' }}>
                        <div>
                          <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>
                            {stream.provider_viewers}
                          </div>
                          <div className="page-sub">{tStreaming('provider.viewersLabel')}</div>
                        </div>
                      </div>
                    ) : null}
                    <div className="stream-row" style={{ justifyContent: 'center', textAlign: 'center' }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{formatLimitValue(derived.totalDurationSeconds ?? 0)}</div>
                        <div className="page-sub">Відеоряд всього</div>
                      </div>
                    </div>
                    <div className="stream-row" style={{ justifyContent: 'center', textAlign: 'center' }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--amber)' }}>{quotaLabel}</div>
                        <div className="page-sub">Залишок ліміту</div>
                      </div>
                    </div>
                    <div className="stream-row" style={{ justifyContent: 'center', textAlign: 'center' }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{activePlanLabel}</div>
                        <div className="page-sub">Поточний тариф</div>
                      </div>
                    </div>
                  </div>

                  <div className="page-actions" style={{ marginTop: 14, marginLeft: 0 }}>
                    <Button size="sm" variant="ghost" onClick={() => { setLogsMode('important'); setViewingLogs(stream.id) }}>📋 Лог</Button>
                    <Button size="sm" variant="ghost" onClick={() => openLiveEditor(stream)}>✏️ Редагувати</Button>
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => handleOpenSchedule(stream)}>🗓️ Розклад</Button>
                  </div>
                </div>
              </article>
            )
          }) : readyEntries.length > 0 ? readyEntries.map(({ stream }) => {
            const sourceName = getStreamSourceLabel(stream)
            const destinationLabel = (stream.destinations ?? []).map((d) => d.name).join(', ') || 'Канал не вказано'
            const isOptimisticallyLive = optimisticRunningStreamIds.includes(stream.id)

            return (
              <article key={stream.id} className="card stream-summary-card">
                <div className="card-content">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <Badge variant={isOptimisticallyLive ? 'live' : 'idle'}>
                      {isOptimisticallyLive ? 'У ЕФІРІ' : 'Готово'}
                    </Badge>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{stream.name || 'Без назви'}</span>
                    <span className="page-sub" style={{ marginLeft: 'auto' }}>{destinationLabel}</span>
                    {isOptimisticallyLive ? (
                      <Button size="sm" variant="danger" onClick={() => handleStopStream(stream.id)} disabled>
                        ⏳ Запускається
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleStartStream(stream)}
                        disabled={pendingStartStreamId === stream.id}
                      >
                        {pendingStartStreamId === stream.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '▶ Запустити'}
                      </Button>
                    )}
                  </div>

                  <div className="stream-row">
                    <div className="stream-thumb">🎬</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--txt-3)' }}>
                        Джерело
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{sourceName}</div>
                    </div>
                    <div className="page-actions" style={{ marginLeft: 'auto' }}>
                      <Button size="sm" variant="ghost" onClick={() => { setLogsMode('important'); setViewingLogs(stream.id) }}>📋 Лог</Button>
                      <Button size="sm" variant="ghost" onClick={() => openLiveEditor(stream)}>✏️ Редагувати</Button>
                    </div>
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
                <Button size="sm" variant="outline" onClick={() => handleOpenSchedule(stream)}>Редагувати</Button>
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
                          <Button size="sm" variant="ghost" onClick={() => { setLogsMode('important'); setViewingLogs(stream.id) }}>📋 Лог</Button>
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

      <StreamScheduleModal
        open={Boolean(scheduleModalStream)}
        stream={scheduleModalStream}
        t={tStreaming}
        onClose={() => setScheduleModalStream(null)}
        onSave={handleSaveSchedule}
        isSaving={updateScheduleMutation.isPending}
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
              <div className="bg-slate-900 text-slate-100 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
                {logsResponse?.logs?.length ? (
                  logsResponse.logs.map((line, index) => (
                    <p
                      key={index}
                      className={
                        /error|failed|forbidden|invalid|denied|fatal/i.test(line)
                          ? 'text-error-300'
                          : 'text-slate-300'
                      }
                    >
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
        onClose={closeLiveEditor}
        onApply={applyLiveEditorChanges}
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
