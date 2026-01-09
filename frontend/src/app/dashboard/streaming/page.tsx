'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient, useQueries } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Locale as DateFnsLocale } from 'date-fns'
import { enUS, ru, uk as ukLocale } from 'date-fns/locale'
import { Play, Loader2 } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'

import { api, ApiError } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import type {
  Destination,
  DestinationUpdatePayload,
  Asset,
  Stream,
  Playlist,
  StreamLogsResponse,
  StreamStatusValue,
  StreamStatusResponse,
  StreamQualityResponse,
  SubscriptionTierKey,
  MediaCollection,
} from '@/lib/types'
import { useDashboardContext } from '../dashboard-context'
import { ChannelsSidebar } from './components/ChannelsSidebar'
import { StreamsList } from './components/StreamsList'
import { ChannelFormModal } from './components/ChannelFormModal'
import { StreamLogsModal } from './components/StreamLogsModal'
import { StreamStatsCards } from './components/StreamStatsCards'
import { StreamBuilderModal } from './components/StreamBuilderModal'
import { LiveEditorModal } from './components/LiveEditorModal'
import { QualityGateModal } from './components/QualityGateModal'
import { useLiveEditor } from './hooks/useLiveEditor'
import { useQualityGate } from './hooks/useQualityGate'
import type { DestinationFormState } from './types'

const statusVariantMap: Record<StreamStatusValue, 'success' | 'info' | 'warning' | 'error'> = {
  running: 'success',
  stopped: 'info',
  starting: 'warning',
  stopping: 'warning',
  error: 'error',
  scheduled: 'info',
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
  const { qualityGate, openQualityGate, closeQualityGate, groupedViolations } = useQualityGate()

  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [channelForm, setChannelForm] = useState<DestinationFormState>({
    name: '',
    rtmps_url: 'rtmps://a.rtmp.youtube.com/live2',
    stream_key: '',
    enabled: true,
  })
  const [viewingLogs, setViewingLogs] = useState<string | null>(null)
  const [showCreateStream, setShowCreateStream] = useState(false)

  const { data: destinations, isLoading: isLoadingDestinations } = useQuery<Destination[]>({
    queryKey: ['destinations', user?.id],
    queryFn: () => api.destinations.list(),
    enabled: !!user,
  })

  const { data: streams, isLoading: isLoadingStreams } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id],
    queryFn: () => api.streams.list(),
    enabled: !!user,
    refetchInterval: 3000,
  })

  const streamStatusQueries = useQueries({
    queries: (streams ?? []).map((stream) => ({
      queryKey: ['stream-status', user?.id, stream.id],
      queryFn: () => api.streams.status(stream.id),
      enabled: !!user && Boolean(stream?.id),
      refetchInterval: ['running', 'starting', 'error'].includes(stream.status) ? 5000 : 30000,
      retry: false,
    })),
  }) as UseQueryResult<StreamStatusResponse>[]

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
    enabled: !!user && showCreateStream,
  })

  const { data: audioCollections, isLoading: isLoadingAudioCollections } = useQuery<MediaCollection[]>({
    queryKey: ['media-collections', user?.id, 'audio'],
    queryFn: () =>
      api.mediaCollections.list({
        collection_type: 'audio_playlist',
        include_items: true,
      }),
    enabled: !!user && showCreateStream,
  })

  const liveStatusMap = useMemo(() => {
    const map = new Map<string, UseQueryResult<StreamStatusResponse>>()
    streams?.forEach((stream, index) => {
      const query = streamStatusQueries[index]
      if (stream && query) {
        map.set(stream.id, query)
      }
    })
    return map
  }, [streamStatusQueries, streams])

  const playlistMap = useMemo(() => {
    if (!playlists) return new Map<string, Playlist>()
    return new Map(playlists.map((playlist) => [playlist.id, playlist]))
  }, [playlists])

  const runningStreams = useMemo(
    () => (streams ?? []).filter((stream) => stream.status === 'running'),
    [streams],
  )
  const errorStreams = useMemo(
    () => (streams ?? []).filter((stream) => stream.status === 'error'),
    [streams],
  )

  const formatLimitValue = (value?: number | null) => (value == null ? '∞' : value.toString())
  const destinationsLimit = quota?.destinations?.limit ?? null
  const concurrentStreamsLimit = quota?.streams?.limit ?? null
  const planQualityLimits = quota?.quality

  const createDestinationMutation = useMutation({
    mutationFn: (data: DestinationFormState) => api.destinations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations', user?.id] })
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
      queryClient.invalidateQueries({ queryKey: ['destinations', user?.id] })
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
      toast.success(streamingToasts('destination.deleted'))
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
    onSuccess: () => {
      toast.success(streamingToasts('stream.started'))
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
    },
    onError: (error: Error & { quality?: StreamQualityResponse }, variables) => {
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
    onSuccess: () => {
      toast.info(streamingToasts('stream.stopped'))
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

  const handleStartStream = (stream: Stream) =>
    startStreamMutation.mutate({
      streamId: stream.id,
      streamName: stream.name,
    })

  const handleStopStream = (streamId: string) => stopStreamMutation.mutate(streamId)
  const handleDeleteStream = (streamId: string) => deleteStreamMutation.mutate(streamId)

  const { data: logsResponse } = useQuery<StreamLogsResponse>({
    queryKey: ['stream-logs', user?.id, viewingLogs],
    queryFn: () => api.streams.logs(viewingLogs!, 200),
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

  if (!user) {
    return <LoadingState text={tStreaming('loading')} />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">{tStreaming('header.title')}</h2>
          <p className="text-slate-600 dark:text-slate-400">{tStreaming('header.description')}</p>
          <div className="mt-3 inline-flex items-center space-x-2 rounded-full bg-primary-50 dark:bg-primary-900/20 px-3 py-1 text-xs font-medium text-primary-700 dark:text-primary-300">
            <span>{tStreaming('header.planLabel')}</span>
            <span className="font-semibold">
              {quotaLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : activePlanLabel}
            </span>
          </div>
        </div>
        <Button onClick={() => setShowCreateStream(true)} className="flex items-center space-x-2">
          <Play className="w-4 h-4" />
          <span>{tStreaming('header.goLive')}</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <ChannelsSidebar
          destinations={destinations}
          isLoading={isLoadingDestinations}
          selectedChannelId={selectedChannel}
          onSelectChannel={setSelectedChannel}
          onCreateChannel={() => setShowChannelForm(true)}
          onEditChannel={handleEditChannel}
          onDeleteChannel={handleDeleteChannel}
          t={tStreaming}
          quotaLoading={quotaLoading}
          destinationsLimit={destinationsLimit}
          formatLimitValue={formatLimitValue}
        />

        <div className="lg:col-span-3 space-y-4">
          <StreamsList
            streams={streams}
            isLoading={isLoadingStreams}
            liveStatusMap={liveStatusMap}
            onCreateStream={() => setShowCreateStream(true)}
            onViewLogs={(streamId) => setViewingLogs(streamId)}
            onOpenLiveEditor={openLiveEditor}
            onStartStream={handleStartStream}
            onStopStream={handleStopStream}
            onDeleteStream={handleDeleteStream}
            renderStatusBadge={renderStatusBadge}
            playlistMap={playlistMap}
            t={tStreaming}
            streamingStatus={streamingStatus}
            dateLocale={dateLocale}
            isStartPending={startStreamMutation.isPending}
            isStopPending={stopStreamMutation.isPending}
            isDeletePending={deleteStreamMutation.isPending}
          />

          <StreamStatsCards
            streams={streams}
            quotaLoading={quotaLoading}
            concurrentStreamsLimit={concurrentStreamsLimit}
            formatLimitValue={formatLimitValue}
            t={tStreaming}
          />
        </div>
      </div>

      <ChannelFormModal
        open={showChannelForm}
        editingChannelId={editingChannelId}
        channelForm={channelForm}
        onChange={setChannelForm}
        onSubmit={handleSubmitChannel}
        onCancel={resetChannelForm}
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

      <StreamLogsModal
        open={Boolean(viewingLogs)}
        logs={logsResponse?.logs}
        onClose={() => setViewingLogs(null)}
        t={tStreaming}
      />

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
