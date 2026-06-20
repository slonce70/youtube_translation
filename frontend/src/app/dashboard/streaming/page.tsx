'use client'
// Sprint 7.2: full i18n migration to streaming.page.* keys.

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Play, Loader2, X, Radio, Gauge, RadioTower, AlertTriangle, CalendarClock, Trash2, Archive } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'

import { api } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type {
  StreamLogsResponse,
  SubscriptionTierKey,
  Stream,
} from '@/lib/types'
import dynamic from 'next/dynamic'
import { useDashboardContext } from '../dashboard-context'
import { useLiveEditor } from './hooks/useLiveEditor'
import { useQualityGate } from './hooks/useQualityGate'
import { useStreamingPageData } from './hooks/useStreamingPageData'
import { useStreamMutations } from './hooks/useStreamMutations'
import { EmptyStateWizard } from '@/components/streaming/EmptyStateWizard'
import { LiveStreamHero } from '@/components/streaming/LiveStreamHero'

// Heavy modals are gated by boolean state and never appear on first paint.
// Lazy-load them so the streaming page's first-load JS shrinks by the
// modal payload and the libraries they pull in (form + chart helpers).
const StreamBuilderModal = dynamic(
  () => import('./components/StreamBuilderModal').then((mod) => mod.StreamBuilderModal),
  { ssr: false },
)
const LiveEditorModal = dynamic(
  () => import('./components/LiveEditorModal').then((mod) => mod.LiveEditorModal),
  { ssr: false },
)
const QualityGateModal = dynamic(
  () => import('./components/QualityGateModal').then((mod) => mod.QualityGateModal),
  { ssr: false },
)
import {
  buildStreamIncidentNotice,
  deriveStreamState,
  getStreamLogLineClassName,
  summarizeStreamLogIncidents,
} from '@/lib/stream-state'
import { formatDateTimeLocal, type ScheduleDraft } from './schedule-utils'
import { extractStopAuditEntries } from './log-audit'

export default function StreamingPage() {
  return (
    <Suspense fallback={null}>
      <StreamingPageContent />
    </Suspense>
  )
}

function StreamingPageContent() {
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

  const [viewingLogs, setViewingLogs] = useState<string | null>(null)
  const [logsMode, setLogsMode] = useState<'important' | 'raw'>('important')
  const [showCreateStream, setShowCreateStream] = useState(false)
  const [activeStreamTab, setActiveStreamTab] = useState<'live' | 'scheduled' | 'archive'>('live')
  const [liveEditorScheduleDraft, setLiveEditorScheduleDraft] = useState<ScheduleDraft | null>(null)
  const [liveEditorNameDraft, setLiveEditorNameDraft] = useState('')
  const [liveEditorDestinationIds, setLiveEditorDestinationIds] = useState<string[]>([])

  const {
    assets,
    audioCollections,
    concurrentStreamsLimit,
    destinations,
    destinationsLimit,
    formatLimitValue,
    getStreamSourceLabel,
    isLoadingAssets,
    isLoadingAudioCollections,
    isLoadingDestinations,
    isLoadingStreams,
    isLoadingVideoCollections,
    planQualityLimits,
    streams,
    videoCollections,
  } = useStreamingPageData({
    userId: user?.id,
    quota,
    tStreaming,
  })

  function handleDeleteStreamSuccess(streamId: string) {
    if (viewingLogs === streamId) {
      setViewingLogs(null)
    }
  }

  const {
    updateScheduleMutation,
    startStreamMutation,
    stopStreamMutation,
    deleteStreamMutation,
    optimisticRunningStreamIds,
    optimisticStoppingStreamIds,
    pendingStartStreamId,
    pendingStopStreamId,
    pendingDeleteStreamId,
  } = useStreamMutations({
    userId: user?.id,
    streamingToasts,
    openQualityGate,
    onDeleteStreamSuccess: handleDeleteStreamSuccess,
  })

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

  const handleStartStream = (stream: Stream) => {
    setActiveStreamTab('live')
    startStreamMutation.mutate({
      streamId: stream.id,
      streamName: stream.name,
    })
  }

  const handleStopStream = (streamId: string) => {
    setActiveStreamTab('live')
    stopStreamMutation.mutate(streamId)
  }
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
        derived: deriveStreamState(stream),
      })),
    [streams],
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

  // Track 5b/D / RULE 6, 7: detect first-run state. When the operator
  // has neither a channel nor an asset, show the 3-step wizard instead
  // of the empty stat-strip + tabs cascade. Once they finish setup, the
  // wizard goes away on its own and the regular page returns.
  const isFirstRun =
    !isLoadingDestinations &&
    !isLoadingAssets &&
    (destinations?.length ?? 0) === 0 &&
    (assets?.length ?? 0) === 0 &&
    (streams?.length ?? 0) === 0

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
            <span>{tStreaming('newStream')}</span>
          </Button>
        </div>
      </div>

      {isFirstRun ? (
        <EmptyStateWizard
          hasChannel={(destinations?.length ?? 0) > 0}
          hasAsset={(assets?.length ?? 0) > 0}
        />
      ) : null}

      <div className="stat-strip">
        <div className="stat-strip-card">
          <span className="stat-strip-icon is-live" aria-hidden="true"><Radio className="h-[18px] w-[18px]" /></span>
          <div>
            <div className="stat-strip-value">{runningStreams.length}</div>
            <div className="page-sub">{tStreaming('stats.activeStreams')}</div>
          </div>
        </div>
        <div className="stat-strip-card">
          <span className="stat-strip-icon" aria-hidden="true"><Gauge className="h-[18px] w-[18px]" /></span>
          <div>
            <div className="stat-strip-value">
              {runningStreams.length}/{formatLimitValue(concurrentStreamsLimit)}
            </div>
            <div className="page-sub">{tStreaming('stats.parallelLimit')}</div>
          </div>
        </div>
        <div className="stat-strip-card">
          <span className="stat-strip-icon" aria-hidden="true"><RadioTower className="h-[18px] w-[18px]" /></span>
          <div>
            <div className="stat-strip-value">
              {destinations?.length || 0}/{formatLimitValue(destinationsLimit)}
            </div>
            <div className="page-sub">{tStreaming('stats.channelsAdded')}</div>
          </div>
        </div>
        <div className="stat-strip-card">
          <span className="stat-strip-icon is-warn" aria-hidden="true"><AlertTriangle className="h-[18px] w-[18px]" /></span>
          <div>
            <div className="stat-strip-value" style={{ color: degradedLiveEntries.length ? 'var(--amber)' : undefined }}>
              {degradedLiveEntries.length}
            </div>
            <div className="page-sub">{tStreaming('stats.degraded')}</div>
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label={tStreaming('tablistLabel')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeStreamTab === 'live'}
          className={`tab-btn ${activeStreamTab === 'live' ? 'active' : ''}`}
          onClick={() => setActiveStreamTab('live')}
        >
          <span className="tab-btn-label">{tStreaming('tabs.live')}</span>
          {liveEntries.length ? <span className="tab-badge">{liveEntries.length}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeStreamTab === 'scheduled'}
          className={`tab-btn ${activeStreamTab === 'scheduled' ? 'active' : ''}`}
          onClick={() => setActiveStreamTab('scheduled')}
        >
          <span className="tab-btn-label">{tStreaming('tabs.scheduled')}</span>
          {scheduledEntries.length ? <span className="tab-badge tab-badge-active">{scheduledEntries.length}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeStreamTab === 'archive'}
          className={`tab-btn ${activeStreamTab === 'archive' ? 'active' : ''}`}
          onClick={() => setActiveStreamTab('archive')}
        >
          <span className="tab-btn-label">{tStreaming('tabs.archive')}</span>
          {archiveEntries.length ? <span className="tab-badge tab-badge-muted">{archiveEntries.length}</span> : null}
        </button>
      </div>

      {activeStreamTab === 'live' ? (
        <div className="summary-list">
          {/* Track 5b/D: modern operator hero answers the most-asked
            *  questions ("is it up?", "what's playing?", bitrate
            *  stability) up front. Per-stream hero self-fetches
            *  status + events + metrics. */}
          {liveEntries.map(({ stream }) => (
            <LiveStreamHero
              key={`hero-${stream.id}`}
              stream={stream}
              linkToDetail
              isStopping={pendingStopStreamId === stream.id}
              isRestarting={pendingStartStreamId === stream.id}
              onStop={() => handleStopStream(stream.id)}
              onRestart={() => handleStartStream(stream)}
            />
          ))}
          {liveEntries.length === 0 ? (
            <Card>
              <CardContent>
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-icon" aria-hidden="true"><RadioTower className="h-7 w-7" /></div>
                  <div className="empty-title">{tStreaming('active.emptyTitle')}</div>
                  <div className="empty-sub">{tStreaming('active.emptyDescription')}</div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeStreamTab === 'scheduled' ? (
        <Card>
          <CardHeader><CardTitle>{tStreaming('scheduled.title')}</CardTitle></CardHeader>
          <CardContent className="summary-list">
            {scheduledEntries.length > 0 ? scheduledEntries.map(({ stream }) => (
              <div key={stream.id} className="stream-row">
                <div className="stream-thumb" aria-hidden="true"><CalendarClock className="h-5 w-5" /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{stream.name || tStreaming('streams.untitled')}</div>
                  <div className="page-sub">{stream.scheduled_start_time ? new Date(stream.scheduled_start_time).toLocaleString() : tStreaming('scheduled.fallbackLabel')}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Button size="sm" onClick={() => handleStartStream(stream)} disabled={pendingStartStreamId === stream.id}>
                    {pendingStartStreamId === stream.id ? <Loader2 className="h-4 w-4 animate-spin" /> : tStreaming('scheduled.startStream')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleOpenStreamEditor(stream)}>{tStreaming('scheduled.editStream')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setLogsMode('important'); setViewingLogs(stream.id) }}>{tStreaming('scheduled.logButton')}</Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleDeleteStream(stream)}
                    disabled={pendingDeleteStreamId === stream.id}
                  >
                    {pendingDeleteStreamId === stream.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className="inline-flex items-center gap-1.5"><Trash2 className="h-3.5 w-3.5" />{tStreaming('streams.buttons.delete')}</span>
                    )}
                  </Button>
                </div>
              </div>
            )) : (
              <div className="empty-state" style={{ padding: '36px 20px' }}>
                <div className="empty-icon" aria-hidden="true"><CalendarClock className="h-7 w-7" /></div>
                <div className="empty-title">{tStreaming('scheduled.emptyTitle')}</div>
                <div className="empty-sub">{tStreaming('scheduled.emptyDescription')}</div>
                <Button size="sm" variant="outline" onClick={() => setShowCreateStream(true)} style={{ marginTop: 12 }}>
                  {tStreaming('scheduled.scheduleStream')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {activeStreamTab === 'archive' ? (
        <Card>
          <CardHeader><CardTitle>{tStreaming('archive.title')}</CardTitle></CardHeader>
          <CardContent className="table-wrap">
            {archiveEntries.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>{tStreaming('archive.tableName')}</th>
                    <th>{tStreaming('archive.tableSource')}</th>
                    <th>{tStreaming('archive.tableChannel')}</th>
                    <th>{tStreaming('archive.tableDate')}</th>
                    <th>{tStreaming('archive.tableActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {archiveEntries.map(({ stream }) => (
                    <tr key={stream.id}>
                      <td>{stream.name || tStreaming('streams.untitled')}</td>
                      <td>{getStreamSourceLabel(stream)}</td>
                      <td>{(stream.destinations ?? []).map((d) => d.name).join(', ') || tStreaming('archive.fallbackChannel')}</td>
                      <td>{new Date(stream.created_at).toLocaleString()}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <Button size="sm" onClick={() => handleStartStream(stream)} disabled={pendingStartStreamId === stream.id}>
                            {pendingStartStreamId === stream.id ? <Loader2 className="h-4 w-4 animate-spin" /> : tStreaming('scheduled.startStream')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleOpenStreamEditor(stream)}>{tStreaming('scheduled.editStream')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setLogsMode('important'); setViewingLogs(stream.id) }}>{tStreaming('scheduled.logButton')}</Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDeleteStream(stream)}
                            disabled={pendingDeleteStreamId === stream.id}
                          >
                            {pendingDeleteStreamId === stream.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <span className="inline-flex items-center gap-1.5"><Trash2 className="h-3.5 w-3.5" />{tStreaming('streams.buttons.delete')}</span>
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
                <div className="empty-icon" aria-hidden="true"><Archive className="h-7 w-7" /></div>
                <div className="empty-title">{tStreaming('archive.emptyTitle')}</div>
                <div className="empty-sub">{tStreaming('archive.emptyDescription')}</div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <StreamBuilderModal
        open={showCreateStream}
        onClose={() => setShowCreateStream(false)}
        onOpenChannelForm={() => router.push('/dashboard/channels')}
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
                    {tStreaming('runtimeContext')}
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
                    {tStreaming('incidentDigest')}
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
                  logsResponse.logs.map((line) => (
                    <p key={line} className={getStreamLogLineClassName(line)}>
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
