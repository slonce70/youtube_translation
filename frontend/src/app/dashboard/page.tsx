'use client'
/* eslint-disable i18next/no-literal-string */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { api } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LiveDot } from '@/components/ui/LiveDot'
import { useDashboardContext } from './dashboard-context'
import { useStreamSocket } from './streaming/hooks/useStreamSocket'
import type { Asset, Stream, SubscriptionTierKey } from '@/lib/types'
import { useStreamStatusMap } from './streaming/hooks/useStreamStatusMap'
import { deriveStreamState, getStreamPriority } from '@/lib/stream-state'
import { formatBytes, formatDuration } from '@/lib/utils'

export default function DashboardPage() {
  const router = useRouter()
  const dashboard = useTranslations('dashboard')
  const nav = useTranslations('nav')
  const { user, quota, quotaLoading, currentTier, planDetail } = useDashboardContext()
  useStreamSocket(user?.id)

  const { data: streams, isLoading: streamsLoading } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id],
    queryFn: api.streams.list,
    enabled: !!user,
    refetchInterval: typeof document !== 'undefined' && document.visibilityState === 'visible' ? 5000 : false,
    refetchOnWindowFocus: true,
  })

  const { data: assets, isLoading: assetsLoading } = useQuery<Asset[]>({
    queryKey: ['assets', user?.id, 'dashboard'],
    queryFn: () => api.assets.list(),
    enabled: !!user,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  const liveStatusMap = useStreamStatusMap(streams, user?.id)
  const presentedStreams = useMemo(
    () =>
      (streams ?? [])
        .map((stream) => ({ stream, derived: deriveStreamState(stream, liveStatusMap.get(stream.id)) }))
        .sort((a, b) => getStreamPriority(b.derived) - getStreamPriority(a.derived)),
    [liveStatusMap, streams],
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
  const userLabel = user?.user_metadata?.display_name || user?.email || 'Стример'
  const subtitle = `Привіт, ${userLabel} 👋 — сьогодні ${new Intl.DateTimeFormat('uk-UA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())}`
  const currentPlanLabel = currentTier ? dashboard('quota.tiers.' + (currentTier as SubscriptionTierKey)) : 'Free'

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="page-title">Дашборд</div>
          <div className="page-sub">{subtitle}</div>
        </div>
        <div className="page-actions">
          <Button variant="outline" size="sm" className="hero-action-btn" onClick={() => router.push('/dashboard/schedule')}>
            🗓️ Запланувати
          </Button>
          <Button className="hero-action-btn" onClick={() => router.push('/dashboard/streaming?new=1')}>
            🎙️ Почати трансляцію
          </Button>
        </div>
      </div>

      <div className="live-banner">
        <LiveDot />
        <span style={{ fontWeight: 600, color: 'var(--green)' }}>{liveCount} активні трансляції</span>
        <span style={{ color: 'var(--txt-2)', fontSize: 13 }}>
          {scheduledCount > 0 ? `· ${scheduledCount} заплановано` : `· ${attentionCount} потребують уваги`} · План {currentPlanLabel}
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => router.push('/dashboard/streaming')}>
          Перейти →
        </Button>
      </div>

      <div className="stats-row">
        <div className="stat-card" style={{ ['--accent' as string]: 'var(--indigo)', ['--icon-bg' as string]: 'rgba(99,102,241,.15)' }}>
          <div className="stat-icon">📁</div>
          <div className="stat-value">{usage.assetsCount}</div>
          <div className="stat-label">Файлів у бібліотеці</div>
          <div className="stat-delta delta-up">▲ {recentAssets.length} нових останнім часом</div>
        </div>
        <div className="stat-card" style={{ ['--accent' as string]: 'var(--green)', ['--icon-bg' as string]: 'rgba(34,197,94,.12)' }}>
          <div className="stat-icon">📡</div>
          <div className="stat-value">{liveCount}</div>
          <div className="stat-label">{dashboard('stats.activeStreams')}</div>
          <div className="stat-delta delta-up">▲ {scheduledCount} заплановано</div>
        </div>
        <div className="stat-card" style={{ ['--accent' as string]: 'var(--amber)', ['--icon-bg' as string]: 'rgba(245,158,11,.12)' }}>
          <div className="stat-icon">⚡</div>
          <div className="stat-value">{formatBytes(usage.storageUsedBytes)}</div>
          <div className="stat-label">Сховище використано</div>
          <div style={{ marginTop: 8 }}>
            <ProgressBar value={storagePercent} tone="amber" />
            <div className="page-sub" style={{ marginTop: 4 }}>{Math.round(storagePercent)}% з {planDetail.storageGb} ГБ</div>
          </div>
        </div>
        <div className="stat-card" style={{ ['--accent' as string]: '#a855f7', ['--icon-bg' as string]: 'rgba(168,85,247,.12)' }}>
          <div className="stat-icon">⏱️</div>
          <div className="stat-value">{formatDuration(Math.round((usage.hoursUsed || 0) * 3600))}</div>
          <div className="stat-label">Час трансляцій сьогодні</div>
          <div className="stat-delta delta-up">▲ Усього {usage.totalLifetimeHours.toFixed(1)} год</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardHeader className="mb-4 flex-row items-center justify-between">
              <CardTitle>🔴 Активні трансляції</CardTitle>
              {liveStreams.length > 0 ? (
                <Badge variant="live"><LiveDot />Live</Badge>
              ) : (
                <Badge variant="idle">Немає live</Badge>
              )}
            </CardHeader>
            <CardContent className="summary-list">
              {liveStreams.length > 0 ? liveStreams.map(({ stream, derived }) => (
                <div key={stream.id} className="stream-row active" style={{ alignItems: 'stretch' }}>
                  <div className="stream-thumb">🎬</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{stream.name || 'Без назви'}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <Badge variant="live"><LiveDot />{formatDuration(derived.liveDurationSeconds ?? 0)}</Badge>
                      {(stream.destinations ?? []).slice(0, 2).map((destination) => (
                        <Badge key={destination.id} variant="indigo">{destination.name}</Badge>
                      ))}
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>Здоров’я потоку</span>
                        <span style={{ color: 'var(--green)', fontSize: 12, fontWeight: 600, marginLeft: 'auto' }}>
                          {derived.requiresAttention ? 'Потрібна увага' : 'Відмінне'}
                        </span>
                      </div>
                      <ProgressBar value={derived.requiresAttention ? 62 : 92} tone={derived.requiresAttention ? 'amber' : 'green'} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Button size="sm" variant="outline" onClick={() => router.push('/dashboard/streaming')}>Стат.</Button>
                    <Button size="sm" variant="danger" onClick={() => router.push('/dashboard/streaming')}>■ Зупинити</Button>
                  </div>
                </div>
              )) : (
                <div className="empty-state" style={{ padding: '28px 16px' }}>
                  <div className="empty-icon">📡</div>
                  <div className="empty-title">Активних live-ефірів немає</div>
                  <div className="empty-sub">Створіть трансляцію або заплануйте ефір — активні стріми з’являться тут тільки після запуску.</div>
                  <div className="page-actions" style={{ marginTop: 14, marginLeft: 0, justifyContent: 'center' }}>
                    <Button size="sm" variant="outline" onClick={() => router.push('/dashboard/library?tab=assets')}>Файли</Button>
                    <Button size="sm" onClick={() => router.push('/dashboard/streaming?new=1')}>Запустити</Button>
                    <Button size="sm" variant="outline" onClick={() => router.push('/dashboard/schedule')}>Розклад</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="mb-4 flex-row items-center justify-between">
              <CardTitle>📁 Останні файли</CardTitle>
              <Link href="/dashboard/library" className="btn btn-ghost btn-sm">Всі файли →</Link>
            </CardHeader>
            <CardContent className="table-wrap">
              {recentAssets.length > 0 ? (
                <table className="table">
                  <thead>
                    <tr><th>Файл</th><th>Розмір</th><th>Тривалість</th><th>Дія</th></tr>
                  </thead>
                  <tbody>
                    {recentAssets.map((asset) => (
                      <tr key={asset.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="table-thumb">{asset.asset_type === 'audio' ? '🎵' : '🎬'}</div>
                            <span>{asset.filename}</span>
                          </div>
                        </td>
                        <td style={{ color: 'var(--txt-2)' }}>{formatBytes(asset.size_bytes)}</td>
                        <td style={{ color: 'var(--txt-2)' }}>{asset.duration_seconds ? formatDuration(asset.duration_seconds) : '—'}</td>
                        <td><Button size="sm" variant="ghost" onClick={() => router.push('/dashboard/library')}>Відкрити</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state" style={{ padding: '28px 12px 20px' }}>
                  <div className="empty-icon">📁</div>
                  <div className="empty-title">Бібліотека поки порожня</div>
                  <div className="empty-sub">Завантажте перший файл, щоб швидко запускати трансляції зі стріму.</div>
                  <Button size="sm" style={{ marginTop: 12 }} onClick={() => router.push('/dashboard/library?tab=assets')}>
                    ⬆ Завантажити файл
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="dashboard-side">
          <Card className="card-sm">
            <CardTitle>⚡ Швидкі дії</CardTitle>
            <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              <Button fullWidth onClick={() => router.push('/dashboard/streaming?new=1')}>🎙️ Розпочати трансляцію</Button>
              <Button fullWidth variant="outline" onClick={() => router.push('/dashboard/library?tab=assets')}>📁 Завантажити файл</Button>
              <Button fullWidth variant="outline" onClick={() => router.push('/dashboard/streaming')}>🗓️ Запланувати стрім</Button>
            </CardContent>
          </Card>

          <Card className="card-sm">
            <CardTitle>💾 Сховище</CardTitle>
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
              <div style={{ fontSize: 13, fontWeight: 600 }}>{formatBytes(usage.storageUsedBytes)} / {planDetail.storageGb} ГБ</div>
              <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 4 }}>~ {formatBytes(remainingStorage)} вільно</div>
              <div className="storage-breakdown">
                <div className="storage-breakdown-row">
                  <span>🎬 Відео</span>
                  <span>{formatBytes(storageBreakdown.video)}</span>
                </div>
                <div className="storage-breakdown-row">
                  <span>🎵 Аудіо</span>
                  <span>{formatBytes(storageBreakdown.audio)}</span>
                </div>
                <div className="storage-breakdown-row">
                  <span>📦 Інше</span>
                  <span>{formatBytes(storageBreakdown.other)}</span>
                </div>
              </div>
              <Button fullWidth variant="ghost" size="sm" style={{ marginTop: 12 }} onClick={() => router.push('/dashboard/library')}>
                Керувати файлами →
              </Button>
            </CardContent>
          </Card>

          <Card className="card-sm">
            <CardTitle>🗓️ Сьогодні в розкладі</CardTitle>
            <CardContent className="summary-list" style={{ marginTop: 12 }}>
              {scheduledStreams.length > 0 ? scheduledStreams.map(({ stream }) => (
                <div key={stream.id} className="stream-row">
                  <div className="stream-thumb">🗓️</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{stream.name || 'Без назви'}</div>
                    <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{stream.scheduled_start_time ? new Date(stream.scheduled_start_time).toLocaleString() : 'Заплановано'}</div>
                  </div>
                </div>
              )) : (
                <div className="empty-state" style={{ padding: '24px 12px' }}>
                  <div className="empty-icon">🗓️</div>
                  <div className="empty-title">Немає запланованих подій</div>
                  <div className="empty-sub">Створіть стрім і оберіть запланований старт.</div>
                </div>
              )}
              <Button fullWidth variant="ghost" size="sm" onClick={() => router.push('/dashboard/schedule')}>
                Повний розклад →
              </Button>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  )
}
