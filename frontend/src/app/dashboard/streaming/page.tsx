'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Play, Loader2, X, Info, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
  StreamSchedulePayload,
} from '@/lib/types'
import { useDashboardContext } from '../dashboard-context'
import { ChannelsSidebar } from './components/ChannelsSidebar'
import { StreamsList } from './components/StreamsList'
import { StreamBuilderModal } from './components/StreamBuilderModal'
import { LiveEditorModal } from './components/LiveEditorModal'
import { QualityGateModal } from './components/QualityGateModal'
import { StreamScheduleModal } from './components/StreamScheduleModal'
import { useLiveEditor } from './hooks/useLiveEditor'
import { useQualityGate } from './hooks/useQualityGate'
import { useStreamStatusMap } from './hooks/useStreamStatusMap'

type DestinationFormState = {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
}

const statusVariantMap: Record<StreamStatusValue, 'secondary' | 'error' | 'success' | 'info'> = {
  running: 'success',
  stopped: 'secondary',
  starting: 'info',
  stopping: 'info',
  error: 'error',
  scheduled: 'info',
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
  const [scheduleModalStream, setScheduleModalStream] = useState<Stream | null>(null)

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

  const runningStreams = useMemo(
    () => (streams ?? []).filter((stream) => stream.status === 'running'),
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

  const renderStatusBadge = (status: StreamStatusValue) => (
    <Badge variant={statusVariantMap[status]} className={status === 'running' ? 'gap-1' : undefined}>
      {status === 'running' ? <span className="h-2 w-2 rounded-full bg-success-600" /> : null}
      {streamingStatus(status)}
    </Badge>
  )

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

  if (!user) {
    return <LoadingState text={tStreaming('loading')} />
  }

  return (
    <div className="space-y-6">
      {/* Header with inline stats */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">{tStreaming('header.title')}</h2>
          <p className="text-slate-600 dark:text-slate-400">{tStreaming('header.description')}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Compact inline stats */}
          <div className="hidden sm:flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success-200 bg-success-50 px-3 py-1 text-xs font-semibold text-success-700 dark:border-success-900/40 dark:bg-success-900/20 dark:text-success-300">
              <span className="h-2 w-2 rounded-full bg-success-500 animate-pulse" />
              {runningStreams.length} {tStreaming('streams.stats.active')}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {streams?.length || 0} {tStreaming('streams.stats.total')}
            </span>
            {quotaLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 dark:border-primary-900/40 dark:bg-primary-900/20 dark:text-primary-300">
                {runningStreams.length}/{formatLimitValue(concurrentStreamsLimit)} {tStreaming('streams.stats.concurrent')}
              </span>
            )}
          </div>
          <Button onClick={() => setShowCreateStream(true)} className="flex items-center space-x-2">
            <Play className="w-4 h-4" />
            <span>{tStreaming('header.goLive')}</span>
          </Button>
        </div>
      </div>

      {/* Mobile stats */}
      <div className="flex flex-wrap gap-2 sm:hidden">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success-200 bg-success-50 px-3 py-1 text-xs font-semibold text-success-700 dark:border-success-900/40 dark:bg-success-900/20 dark:text-success-300">
          <span className="h-2 w-2 rounded-full bg-success-500 animate-pulse" />
          {runningStreams.length} {tStreaming('streams.stats.active')}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {streams?.length || 0} {tStreaming('streams.stats.total')}
        </span>
      </div>

      <Card>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4">
            <span className="text-base font-semibold text-slate-900 dark:text-white">
              {tStreaming('checklist.title')}
            </span>
            <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180 dark:text-slate-400" />
          </summary>
          <div className="px-6 pb-6 text-sm text-slate-600 dark:text-slate-300">
            <ul className="list-disc space-y-2 pl-5">
              <li>{tStreaming('checklist.items.destination')}</li>
              <li>{tStreaming('checklist.items.assets')}</li>
              <li>{tStreaming('checklist.items.schedule')}</li>
              <li>{tStreaming('checklist.items.test')}</li>
            </ul>
          </div>
        </details>
      </Card>

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

        <div className="lg:col-span-3">
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
            onEditSchedule={handleOpenSchedule}
            renderStatusBadge={renderStatusBadge}
            playlistMap={playlistMap}
            videoCollectionMap={videoCollectionMap}
            audioCollectionMap={audioCollectionMap}
            t={tStreaming}
            streamingStatus={streamingStatus}
            pendingStartStreamId={pendingStartStreamId}
            pendingStopStreamId={pendingStopStreamId}
            pendingDeleteStreamId={pendingDeleteStreamId}
          />
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
