'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient, useQueries } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Locale as DateFnsLocale } from 'date-fns'
import { enUS, ru, uk as ukLocale } from 'date-fns/locale'
import { Play, Loader2, X, Info } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'

import { api, ApiError } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
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
import { StreamBuilderModal } from './components/StreamBuilderModal'
import { LiveEditorModal } from './components/LiveEditorModal'
import { QualityGateModal } from './components/QualityGateModal'
import { useLiveEditor } from './hooks/useLiveEditor'
import { useQualityGate } from './hooks/useQualityGate'

type DestinationFormState = {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
}

const statusVariantMap: Record<StreamStatusValue, 'secondary' | 'error'> = {
  running: 'secondary',
  stopped: 'secondary',
  starting: 'secondary',
  stopping: 'secondary',
  error: 'error',
  scheduled: 'secondary',
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
  const [logsMode, setLogsMode] = useState<'important' | 'raw'>('important')
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
      refetchInterval: ['running', 'starting', 'stopping', 'error'].includes(stream.status) ? 5000 : 30000,
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
            onViewLogs={(streamId) => {
              setLogsMode('important')
              setViewingLogs(streamId)
            }}
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-success-600">
                    {streams?.filter((s) => s.status === 'running').length || 0}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {tStreaming('streams.stats.active')}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold gradient-text">{streams?.length || 0}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {tStreaming('streams.stats.total')}
                  </p>
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
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {tStreaming('streams.stats.concurrent')}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {showChannelForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-lg animate-scale-in">
            <CardHeader>
              <CardTitle>
                {editingChannelId
                  ? tStreaming('channels.form.editTitle')
                  : tStreaming('channels.form.newTitle')}
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
                    onChange={(event) => setChannelForm({ ...channelForm, name: event.target.value })}
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
                    onChange={(event) => setChannelForm({ ...channelForm, rtmps_url: event.target.value })}
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {tStreaming('channels.form.help.rtmpsHint')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {tStreaming('channels.form.keyLabel')} {editingChannelId ? tStreaming('channels.form.keepExisting') : ''}
                  </label>
                  <Input
                    type="password"
                    required={!editingChannelId}
                    value={channelForm.stream_key}
                    onChange={(event) => setChannelForm({ ...channelForm, stream_key: event.target.value })}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {tStreaming('channels.form.keyHint')}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
                  <div className="mb-2 flex items-center gap-2 font-semibold">
                    <Info className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                    <span>{tStreaming('channels.form.help.title')}</span>
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                    <li>{tStreaming('channels.form.help.steps.openStudio')}</li>
                    <li>{tStreaming('channels.form.help.steps.goLive')}</li>
                    <li>{tStreaming('channels.form.help.steps.copyKey')}</li>
                  </ul>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {tStreaming('channels.form.help.note')}
                  </p>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={channelForm.enabled}
                    onChange={(event) => setChannelForm({ ...channelForm, enabled: event.target.checked })}
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
                    isLoading={
                      createDestinationMutation.isPending || updateDestinationMutation.isPending
                    }
                  >
                    {editingChannelId
                      ? tStreaming('channels.form.update')
                      : tStreaming('channels.form.create')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

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
