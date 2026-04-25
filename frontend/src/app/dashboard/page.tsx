'use client'
// Sprint 6.6: full i18n migration completed. All user-visible strings now
// go through `dashboard.home.*` keys and have en/uk/ru translations. The
// previous TODO(sprint-3.5) and eslint-disable have been lifted.

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LiveDot } from '@/components/ui/LiveDot'
import { useDashboardContext } from './dashboard-context'
import type { Asset, Stream, SubscriptionTierKey } from '@/lib/types'
import { deriveStreamState, getStreamPriority } from '@/lib/stream-state'
import { formatBytes, formatDuration } from '@/lib/utils'

export default function DashboardPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const dashboard = useTranslations('dashboard')
  const home = useTranslations('dashboard.home')
  const nav = useTranslations('nav')
  const streamingToasts = useTranslations('streaming.toasts')
  const { user, quota, quotaLoading, currentTier, planDetail } = useDashboardContext()

  const { data: streams, isLoading: streamsLoading } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id],
    queryFn: api.streams.list,
    enabled: !!user,
    // Function form is re-evaluated by React Query between refetches, so the
    // interval shrinks when a stream is live and stops entirely when the tab
    // is hidden — saves both API load and laptop battery.
    refetchInterval: (query) => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
        return false
      }
      const current = query.state.data ?? []
      const hasLive = current.some(
        (stream) => stream.status === 'running' || stream.status === 'starting',
      )
      return hasLive ? 5000 : 30_000
    },
    refetchOnWindowFocus: true,
  })

  const { data: assets, isLoading: assetsLoading } = useQuery<Asset[]>({
    queryKey: ['assets', user?.id, 'dashboard'],
    queryFn: () => api.assets.list(),
    enabled: !!user,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  const stopStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.stop(streamId),
    onSuccess: async (_, streamId) => {
      toast.info(streamingToasts('stream.stopped'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stream-status', user?.id, streamId] }),
        queryClient.invalidateQueries({ queryKey: ['streams', user?.id] }),
      ])
    },
    onError: (error: Error) => {
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message }))
    },
  })
  const presentedStreams = useMemo(
    () =>
      (streams ?? [])
        .map((stream) => ({ stream, derived: deriveStreamState(stream) }))
        .sort((a, b) => getStreamPriority(b.derived) - getStreamPriority(a.derived)),
    [streams],
  )

  const usage = useMemo(() => {
    const activeStreams = presentedStreams.filter(({ derived }) => derived.isRunning).map(({ stream }) => stream)
    const storageUsedBytes =
      quota?.storage.used_bytes ?? (assets ?? []).reduce((total, asset) => total + (asset.size_bytes ?? 0), 0)
    const hoursUsed = quota?.streaming_hours.used ?? 0
    const totalLifetimeHours = presentedStreams.reduce(
      (total, { derived }) => total + ((derived.totalDurationSeconds ?? 0) / 3600),
      0,
    )

    return {
      activeStreams,
      assetsCount: quota?.assets.count ?? assets?.length ?? 0,
      hoursUsed,
      totalLifetimeHours,
      storageUsedBytes,
    }
  }, [assets, presentedStreams, quota])

  const storageBreakdown = useMemo(() => {
    const totals = (assets ?? []).reduce(
      (acc, asset) => {
        if (asset.asset_type === 'audio') {
          acc.audio += asset.size_bytes ?? 0
        } else {
          acc.video += asset.size_bytes ?? 0
        }
        return acc
      },
      { video: 0, audio: 0 },
    )

    return {
      video: totals.video,
      audio: totals.audio,
      other: Math.max(0, usage.storageUsedBytes - totals.video - totals.audio),
    }
  }, [assets, usage.storageUsedBytes])

  const liveCount = presentedStreams.filter(({ derived }) => derived.isRunning).length
  const attentionCount = presentedStreams.filter(({ derived }) => derived.requiresAttention).length
  const scheduledCount = presentedStreams.filter(({ derived }) => derived.group === 'scheduled').length
  const initialLoading = (!streams && !assets && (streamsLoading || assetsLoading)) || (quotaLoading && !quota)
  if (initialLoading) return <LoadingState />

  const storageLimitBytes = planDetail.storageGb * 1024 * 1024 * 1024
  const storagePercent = storageLimitBytes > 0 ? Math.min(100, (usage.storageUsedBytes / storageLimitBytes) * 100) : 0
  const remainingStorage = Math.max(0, storageLimitBytes - usage.storageUsedBytes)
  const sortedAssets = [...(assets ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const recentAssets = sortedAssets.slice(0, 3)
  const liveStreams = presentedStreams.filter(({ derived }) => derived.isRunning).slice(0, 3)
  const scheduledStreams = presentedStreams.filter(({ derived }) => derived.group === 'scheduled').slice(0, 2)
  const pendingStopStreamId = stopStreamMutation.isPending ? stopStreamMutation.variables : null
  const userLabel =
    user?.user_metadata?.display_name || user?.email || home('userFallback')
  const todayDate = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())
  const subtitle = home('subtitleGreeting', { name: userLabel, date: todayDate })
  const currentPlanLabel = currentTier
    ? dashboard('quota.tiers.' + (currentTier as SubscriptionTierKey))
    : home('planFallback')

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="page-title">{home('title')}</div>
          <div className="page-sub">{subtitle}</div>
        </div>
        <div className="page-actions">
          <Button
            variant="outline"
            size="sm"
            className="hero-action-btn"
            onClick={() => router.push('/dashboard/schedule')}
          >
            {home('actions.schedule')}
          </Button>
          <Button
            className="hero-action-btn"
            onClick={() => router.push('/dashboard/streaming?new=1')}
          >
            {home('actions.startStream')}
          </Button>
        </div>
      </div>

      <div className="live-banner">
        <LiveDot />
        <span style={{ fontWeight: 600, color: 'var(--green)' }}>
          {home('liveBanner.activeStreams', { count: liveCount })}
        </span>
        <span style={{ color: 'var(--txt-2)', fontSize: 13 }}>
          {scheduledCount > 0
            ? home('liveBanner.scheduledNote', { count: scheduledCount })
            : home('liveBanner.attentionNote', { count: attentionCount })}{' '}
          {home('liveBanner.planNote', { plan: currentPlanLabel })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => router.push('/dashboard/streaming')}
        >
          {home('liveBanner.goTo')}
        </Button>
      </div>

      <div className="stats-row">
        <div
          className="stat-card"
          style={{
            ['--accent' as string]: 'var(--indigo)',
            ['--icon-bg' as string]: 'rgba(99,102,241,.15)',
          }}
        >
          <div className="stat-icon" aria-hidden="true">{'📁'}</div>
          <div className="stat-value">{usage.assetsCount}</div>
          <div className="stat-label">{home('stats.filesInLibrary')}</div>
          <div className="stat-delta delta-up">
            {home('stats.newRecently', { count: recentAssets.length })}
          </div>
        </div>
        <div
          className="stat-card"
          style={{
            ['--accent' as string]: 'var(--green)',
            ['--icon-bg' as string]: 'rgba(34,197,94,.12)',
          }}
        >
          <div className="stat-icon" aria-hidden="true">{'📡'}</div>
          <div className="stat-value">{liveCount}</div>
          <div className="stat-label">{dashboard('stats.activeStreams')}</div>
          <div className="stat-delta delta-up">
            {home('stats.scheduledDelta', { count: scheduledCount })}
          </div>
        </div>
        <div
          className="stat-card"
          style={{
            ['--accent' as string]: 'var(--amber)',
            ['--icon-bg' as string]: 'rgba(245,158,11,.12)',
          }}
        >
          <div className="stat-icon" aria-hidden="true">{'⚡'}</div>
          <div className="stat-value">{formatBytes(usage.storageUsedBytes)}</div>
          <div className="stat-label">{home('stats.storageUsed')}</div>
          <div style={{ marginTop: 8 }}>
            <ProgressBar value={storagePercent} tone="amber" />
            <div className="page-sub" style={{ marginTop: 4 }}>
              {home('stats.storagePercentOf', {
                percent: Math.round(storagePercent),
                limit: planDetail.storageGb,
              })}
            </div>
          </div>
        </div>
        <div
          className="stat-card"
          style={{
            ['--accent' as string]: '#a855f7',
            ['--icon-bg' as string]: 'rgba(168,85,247,.12)',
          }}
        >
          <div className="stat-icon" aria-hidden="true">{'⏱️'}</div>
          <div className="stat-value">
            {formatDuration(Math.round((usage.hoursUsed || 0) * 3600))}
          </div>
          <div className="stat-label">{home('stats.streamingToday')}</div>
          <div className="stat-delta delta-up">
            {home('stats.totalLifetime', {
              hours: usage.totalLifetimeHours.toFixed(1),
            })}
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardHeader className="mb-4 flex-row items-center justify-between">
              <CardTitle>{home('liveStreams.title')}</CardTitle>
              {liveStreams.length > 0 ? (
                <Badge variant="live">
                  <LiveDot />
                  {home('liveStreams.live')}
                </Badge>
              ) : (
                <Badge variant="idle">{home('liveStreams.noLive')}</Badge>
              )}
            </CardHeader>
            <CardContent className="summary-list">
              {liveStreams.length > 0 ? (
                liveStreams.map(({ stream, derived }) => (
                  <div
                    key={stream.id}
                    className="stream-row active"
                    style={{ alignItems: 'stretch' }}
                  >
                    <div className="stream-thumb" aria-hidden="true">{'🎬'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {stream.name || home('liveStreams.untitled')}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          marginTop: 4,
                          flexWrap: 'wrap',
                        }}
                      >
                        <Badge variant="live">
                          <LiveDot />
                          {formatDuration(derived.liveDurationSeconds ?? 0)}
                        </Badge>
                        {(stream.destinations ?? []).slice(0, 2).map((destination) => (
                          <Badge key={destination.id} variant="indigo">
                            {destination.name}
                          </Badge>
                        ))}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>
                            {home('liveStreams.healthLabel')}
                          </span>
                          <span
                            style={{
                              color: 'var(--green)',
                              fontSize: 12,
                              fontWeight: 600,
                              marginLeft: 'auto',
                            }}
                          >
                            {derived.requiresAttention
                              ? home('liveStreams.healthAttention')
                              : home('liveStreams.healthGood')}
                          </span>
                        </div>
                        <ProgressBar
                          value={derived.requiresAttention ? 62 : 92}
                          tone={derived.requiresAttention ? 'amber' : 'green'}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push('/dashboard/streaming')}
                      >
                        {home('liveStreams.stats')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={pendingStopStreamId === stream.id}
                        onClick={() => stopStreamMutation.mutate(stream.id)}
                      >
                        {home('liveStreams.stop')}
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state" style={{ padding: '28px 16px' }}>
                  <div className="empty-icon" aria-hidden="true">{'📡'}</div>
                  <div className="empty-title">{home('liveStreams.emptyTitle')}</div>
                  <div className="empty-sub">{home('liveStreams.emptyDescription')}</div>
                  <div
                    className="page-actions"
                    style={{
                      marginTop: 14,
                      marginLeft: 0,
                      justifyContent: 'center',
                    }}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push('/dashboard/library?tab=assets')}
                    >
                      {home('liveStreams.openFiles')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => router.push('/dashboard/streaming?new=1')}
                    >
                      {home('liveStreams.launch')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push('/dashboard/schedule')}
                    >
                      {home('liveStreams.openSchedule')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="mb-4 flex-row items-center justify-between">
              <CardTitle>{home('recentAssets.title')}</CardTitle>
              <Link href="/dashboard/library" className="btn btn-ghost btn-sm">
                {home('recentAssets.viewAll')}
              </Link>
            </CardHeader>
            <CardContent className="table-wrap">
              {recentAssets.length > 0 ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>{home('recentAssets.tableFile')}</th>
                      <th>{home('recentAssets.tableSize')}</th>
                      <th>{home('recentAssets.tableDuration')}</th>
                      <th>{home('recentAssets.tableAction')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAssets.map((asset) => (
                      <tr key={asset.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="table-thumb" aria-hidden="true">
                              {asset.asset_type === 'audio' ? '🎵' : '🎬'}
                            </div>
                            <span>{asset.filename}</span>
                          </div>
                        </td>
                        <td style={{ color: 'var(--txt-2)' }}>
                          {formatBytes(asset.size_bytes)}
                        </td>
                        <td style={{ color: 'var(--txt-2)' }}>
                          {asset.duration_seconds
                            ? formatDuration(asset.duration_seconds)
                            : '—'}
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => router.push('/dashboard/library')}
                          >
                            {home('recentAssets.open')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div
                  className="empty-state"
                  style={{ padding: '28px 12px 20px' }}
                >
                  <div className="empty-icon" aria-hidden="true">{'📁'}</div>
                  <div className="empty-title">{home('recentAssets.emptyTitle')}</div>
                  <div className="empty-sub">
                    {home('recentAssets.emptyDescription')}
                  </div>
                  <Button
                    size="sm"
                    style={{ marginTop: 12 }}
                    onClick={() => router.push('/dashboard/library?tab=assets')}
                  >
                    {home('recentAssets.uploadCta')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="dashboard-side">
          <Card className="card-sm">
            <CardTitle>{home('quickActions.title')}</CardTitle>
            <CardContent
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginTop: 12,
              }}
            >
              <Button fullWidth onClick={() => router.push('/dashboard/streaming?new=1')}>
                {home('quickActions.startStreaming')}
              </Button>
              <Button
                fullWidth
                variant="outline"
                onClick={() => router.push('/dashboard/library?tab=assets')}
              >
                {home('quickActions.uploadFile')}
              </Button>
              <Button
                fullWidth
                variant="outline"
                onClick={() => router.push('/dashboard/streaming')}
              >
                {home('quickActions.scheduleStream')}
              </Button>
            </CardContent>
          </Card>

          <Card className="card-sm">
            <CardTitle>{home('storage.title')}</CardTitle>
            <CardContent style={{ textAlign: 'center', marginTop: 12 }}>
              <div className="storage-ring">
                <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: 80, height: 80 }}>
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bg-3)" strokeWidth="3" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9"
                    fill="none"
                    stroke="var(--amber)"
                    strokeWidth="3"
                    strokeDasharray={`${storagePercent} ${100 - storagePercent}`}
                    strokeLinecap="round"
                  />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                  {Math.round(storagePercent)}%
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {home('storage.ofLimit', {
                  used: formatBytes(usage.storageUsedBytes),
                  limit: planDetail.storageGb,
                })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 4 }}>
                {home('storage.freeSpace', {
                  value: formatBytes(remainingStorage),
                })}
              </div>
              <div className="storage-breakdown">
                <div className="storage-breakdown-row">
                  <span>{home('storage.video')}</span>
                  <span>{formatBytes(storageBreakdown.video)}</span>
                </div>
                <div className="storage-breakdown-row">
                  <span>{home('storage.audio')}</span>
                  <span>{formatBytes(storageBreakdown.audio)}</span>
                </div>
                <div className="storage-breakdown-row">
                  <span>{home('storage.other')}</span>
                  <span>{formatBytes(storageBreakdown.other)}</span>
                </div>
              </div>
              <Button
                fullWidth
                variant="ghost"
                size="sm"
                style={{ marginTop: 12 }}
                onClick={() => router.push('/dashboard/library')}
              >
                {home('storage.manage')}
              </Button>
            </CardContent>
          </Card>

          <Card className="card-sm">
            <CardTitle>{home('scheduleSidebar.title')}</CardTitle>
            <CardContent className="summary-list" style={{ marginTop: 12 }}>
              {scheduledStreams.length > 0 ? (
                scheduledStreams.map(({ stream }) => (
                  <div key={stream.id} className="stream-row">
                    <div className="stream-thumb" aria-hidden="true">{'🗓️'}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {stream.name || home('scheduleSidebar.untitled')}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                        {stream.scheduled_start_time
                          ? new Date(stream.scheduled_start_time).toLocaleString()
                          : home('scheduleSidebar.scheduledFallback')}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state" style={{ padding: '24px 12px' }}>
                  <div className="empty-icon" aria-hidden="true">{'🗓️'}</div>
                  <div className="empty-title">
                    {home('scheduleSidebar.emptyTitle')}
                  </div>
                  <div className="empty-sub">
                    {home('scheduleSidebar.emptyDescription')}
                  </div>
                </div>
              )}
              <Button
                fullWidth
                variant="ghost"
                size="sm"
                onClick={() => router.push('/dashboard/schedule')}
              >
                {home('scheduleSidebar.viewFull')}
              </Button>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  )
}
