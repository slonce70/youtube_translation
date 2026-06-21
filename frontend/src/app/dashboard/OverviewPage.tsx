'use client'

// Mission Control overview — the operator's ops home (UX redesign 2026-06).
// Replaces the /dashboard redirect with an at-a-glance health board:
// a global health line, running-stream tiles sorted most-broken-first,
// and a cross-stream events feed. The product is unattended infra, so the
// home answers "are my paid-for streams still alive?" before anything else.

import { useMemo } from 'react'
import Link from 'next/link'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Activity, ArrowUpRight, Eye, Plus } from 'lucide-react'

import { api } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import type { Stream, StreamEventResponse, StreamStatusResponse } from '@/lib/types'
import { deriveStreamState } from '@/lib/stream-state'
import {
  GlobalHealthBanner,
  HealthPill,
  healthOf,
  STATE_COLOR,
  STATE_RANK,
} from '@/components/dashboard/stream-health'
import { useDashboardContext } from './dashboard-context'

function fmtUptime(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '—'
  const total = Math.max(0, Math.floor(totalSeconds))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return d > 0 ? `${d}д ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(total % 60)}`
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

function OverviewTile({ stream }: { stream: Stream }) {
  const t = useTranslations('dashboard.overview')
  const states = useTranslations('dashboard.overview.states')
  const isActive =
    stream.status === 'running' || stream.status === 'starting' || stream.status === 'stopping'
  const statusQuery = useQuery<StreamStatusResponse>({
    queryKey: ['stream-status', stream.id, 'overview'],
    queryFn: () => api.streams.status(stream.id),
    enabled: Boolean(stream.id) && isActive,
    refetchInterval: stream.status === 'running' ? 5_000 : 0,
    refetchOnWindowFocus: false,
  })
  const derived = deriveStreamState(stream, statusQuery)
  const state = healthOf(derived)
  const color = STATE_COLOR[state]
  const bitrateKbps = statusQuery.data?.live_metrics?.bitrate_kbps ?? null
  const viewers = statusQuery.data?.provider_viewers ?? null
  const channel = (stream.destinations ?? []).map((d) => d.name).join(', ')

  return (
    <Link
      href={`/dashboard/streams/${stream.id}`}
      className="overview-tile"
      style={{
        display: 'block',
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        borderTop: `2px solid ${color}`,
        borderRadius: 'var(--radius)',
        padding: 14,
        textDecoration: 'none',
        color: 'var(--txt)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {stream.name || stream.id.slice(0, 8)}
        </span>
        <HealthPill state={state} label={states(state)} />
      </div>

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 18,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: state === 'offline' ? 'var(--txt-3)' : 'var(--txt)',
          }}
        >
          {derived.isRunning ? fmtUptime(derived.liveDurationSeconds) : '—'}
        </span>
        <span className="page-sub" style={{ fontSize: 11 }}>
          {derived.isRunning ? t('tile.uptime') : channel || ' '}
        </span>
      </div>

      {derived.isDegraded && derived.incidentSummary.headline ? (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--amber)', lineHeight: 1.4 }}>
          {derived.incidentSummary.headline}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11.5,
          fontFamily: 'var(--font-mono, monospace)',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--txt-2)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Eye className="h-3.5 w-3.5" />
          {viewers != null ? viewers.toLocaleString() : '—'}
        </span>
        <span style={{ color: bitrateKbps != null ? 'var(--green)' : 'var(--txt-3)' }}>
          {bitrateKbps != null ? `${(bitrateKbps / 1000).toFixed(1)} ${t('tile.mbps')}` : '—'}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--indigo)' }}>
          {t('tile.open')} <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  )
}

function OverviewEvents({ streams }: { streams: Array<{ id: string; name: string }> }) {
  const t = useTranslations('dashboard.overview')
  const capped = streams.slice(0, 6)
  const results = useQueries({
    queries: capped.map((s) => ({
      queryKey: ['stream-events', s.id, 'overview'],
      queryFn: () => api.streams.events(s.id, { limit: 6 }),
      enabled: capped.length > 0,
      refetchInterval: 15_000,
      refetchOnWindowFocus: false,
    })),
  })

  const merged = useMemo(() => {
    const rows: Array<StreamEventResponse & { streamName: string }> = []
    results.forEach((r, i) => {
      const data = (r.data as StreamEventResponse[] | undefined) ?? []
      data.forEach((e) => rows.push({ ...e, streamName: capped[i]?.name ?? '' }))
    })
    return rows
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(','), capped.map((s) => s.id).join(',')])

  const levelColor = (level: StreamEventResponse['level']) =>
    level === 'error' ? 'var(--red)' : level === 'warning' ? 'var(--amber)' : 'var(--txt-3)'

  return (
    <div
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--txt-3)',
          marginBottom: 12,
        }}
      >
        <Activity className="h-3.5 w-3.5" />
        {t('events.title')}
      </div>
      {merged.length === 0 ? (
        <div className="page-sub" style={{ fontSize: 12 }}>
          {t('events.empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {merged.map((e) => (
            <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12.5 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--txt-3)',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0,
                }}
              >
                {fmtTime(e.created_at)}
              </span>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: levelColor(e.level), flexShrink: 0, marginTop: 6 }} />
              <span style={{ color: 'var(--txt-2)', lineHeight: 1.4 }}>
                <strong style={{ color: 'var(--txt)', fontWeight: 600 }}>{e.streamName}</strong>
                {e.streamName ? ' — ' : ''}
                {e.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function OverviewPage() {
  const { user } = useDashboardContext()
  const t = useTranslations('dashboard.overview')

  const { data: streams, isLoading } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id],
    queryFn: () => api.streams.list(),
    enabled: Boolean(user?.id),
  })

  const presented = useMemo(
    () => (streams ?? []).map((stream) => ({ stream, derived: deriveStreamState(stream) })),
    [streams],
  )

  const sorted = useMemo(
    () =>
      [...presented].sort((a, b) => {
        const ra = STATE_RANK[healthOf(a.derived)]
        const rb = STATE_RANK[healthOf(b.derived)]
        if (ra !== rb) return ra - rb
        return (a.stream.name || '').localeCompare(b.stream.name || '')
      }),
    [presented],
  )

  const runningStreams = useMemo(
    () => presented.filter((p) => p.derived.isRunning),
    [presented],
  )
  const attentionCount = useMemo(
    () =>
      presented.filter(
        (p) => p.derived.isDegraded || p.derived.derivedStatus === 'error',
      ).length,
    [presented],
  )
  const runningCount = runningStreams.length
  const healthyCount = runningCount - runningStreams.filter((p) => p.derived.isDegraded).length

  if (!user) return <LoadingState text={t('title')} />

  const hasStreams = (streams?.length ?? 0) > 0
  const bannerText =
    runningCount === 0
      ? t('health.noStreams')
      : attentionCount > 0
        ? t('health.someAttention', { count: attentionCount })
        : t('health.allHealthy')

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="page-title">{t('title')}</div>
          <div className="page-sub">{t('subtitle')}</div>
        </div>
        <div className="page-actions">
          <Link href="/dashboard/streaming?new=1" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Plus className="w-4 h-4" />
            <span>{t('newStream')}</span>
          </Link>
        </div>
      </div>

      {!isLoading && !hasStreams ? (
        <div
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '48px 24px',
            textAlign: 'center',
          }}
        >
          <div className="empty-icon" aria-hidden="true" style={{ marginInline: 'auto' }}>
            <Activity className="h-7 w-7" />
          </div>
          <div className="empty-title" style={{ marginTop: 12 }}>{t('empty.title')}</div>
          <div className="empty-sub">{t('empty.description')}</div>
          <Link href="/dashboard/streaming?new=1" className="btn btn-primary" style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Plus className="w-4 h-4" />
            {t('empty.cta')}
          </Link>
        </div>
      ) : (
        <>
          <GlobalHealthBanner
            attentionCount={attentionCount}
            runningCount={runningCount}
            healthyCount={healthyCount}
            text={bannerText}
            summary={runningCount > 0 ? t('health.summary', { healthy: healthyCount, total: runningCount }) : undefined}
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
            }}
          >
            {sorted.map(({ stream }) => (
              <OverviewTile key={stream.id} stream={stream} />
            ))}
          </div>

          <OverviewEvents
            streams={runningStreams.map((p) => ({
              id: p.stream.id,
              name: p.stream.name || p.stream.id.slice(0, 8),
            }))}
          />
        </>
      )}
    </div>
  )
}
