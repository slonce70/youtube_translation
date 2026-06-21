'use client'

// Track 5b/E: per-stream detail route. Replaces the prior modal-on-modal
// pattern (LiveEditorModal + StreamLogsModal portals stacked over the
// list page) with a deep-linkable URL that supports browser back/forward
// and shareable links for "this specific stream's incident timeline".
//
// Tabs:
//   • Overview — the LiveStreamHero composite (status pill, hero tiles,
//     now-playing, incident timeline). One-stop dashboard for "is this
//     stream healthy and what's it doing right now".
//   • Logs — raw FFmpeg stderr tail with a mode toggle (important
//     filtered vs. raw). Replaces the StreamLogsModal portal.
//   • Events — full /events history (the timeline shown on Overview is
//     truncated to 50; Events shows up to 500).
//
// Keeps the existing /streaming list page intact — this route is an
// additive deep-dive surface, not a replacement for the list. Users can
// navigate here from any stream card via "Open" or directly via URL.

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft, RefreshCcw } from 'lucide-react'

import { api } from '@/lib/api'
import type {
  Stream,
  StreamEventResponse,
  StreamLogsResponse,
} from '@/lib/types'
import { LiveStreamHero } from '@/components/streaming/LiveStreamHero'
import { useDashboardContext } from '../../dashboard-context'

type DetailTab = 'overview' | 'logs' | 'events'

const LEVEL_COLOR: Record<StreamEventResponse['level'], string> = {
  error: 'var(--red)',
  warning: 'var(--amber)',
  info: 'var(--txt-2)',
  debug: 'var(--txt-3)',
}

function fmtTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      hour12: false,
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function StreamDetailPage() {
  const params = useParams<{ id: string }>()
  const tHero = useTranslations('streaming.hero')
  const tStreaming = useTranslations('streaming.page')
  const tDetail = useTranslations('streaming.detail')
  const streamingToasts = useTranslations('streaming.toasts')
  const { user } = useDashboardContext()
  const queryClient = useQueryClient()
  const streamId = params?.id

  // Cockpit lifecycle controls. The Overview tab previously rendered the
  // hero read-only; the operator could see "is it healthy?" but not act on
  // it. Wire Stop/Restart so the detail page is a real control surface.
  const invalidateStream = () => {
    queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
    if (streamId) queryClient.invalidateQueries({ queryKey: ['stream-status', streamId] })
  }
  const stopMutation = useMutation({
    mutationFn: () => api.streams.stop(streamId!),
    onSuccess: () => {
      toast.info(streamingToasts('stream.stopped'))
      invalidateStream()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })
  const startMutation = useMutation({
    mutationFn: () => api.streams.start(streamId!),
    onMutate: () => toast.info(streamingToasts('stream.starting')),
    onSuccess: () => {
      toast.success(streamingToasts('stream.started'))
      invalidateStream()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const [tab, setTab] = useState<DetailTab>('overview')
  const [logsMode, setLogsMode] = useState<'important' | 'raw'>('important')

  // The detail page operates on a single stream; we still use the list
  // query (which the dashboard keeps warm at 5s/30s cadence) to read the
  // base Stream record without firing an extra fetch on first paint.
  const { data: streams } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id],
    queryFn: api.streams.list,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  })
  const stream = useMemo(
    () => streams?.find((s) => s.id === streamId) ?? null,
    [streams, streamId],
  )

  const isRunning = stream?.status === 'running' || stream?.status === 'starting'

  const { data: logs, isLoading: logsLoading, refetch: refetchLogs } = useQuery<StreamLogsResponse>({
    queryKey: ['stream-logs', streamId, logsMode],
    queryFn: () => api.streams.logs(streamId!, { lines: 500, mode: logsMode }),
    enabled: Boolean(streamId) && tab === 'logs',
    refetchInterval: tab === 'logs' && isRunning ? 5_000 : false,
    refetchOnWindowFocus: false,
  })

  const { data: events, isLoading: eventsLoading, refetch: refetchEvents } = useQuery<StreamEventResponse[]>({
    queryKey: ['stream-events', streamId, 'detail'],
    queryFn: () => api.streams.events(streamId!, { limit: 500 }),
    enabled: Boolean(streamId) && tab === 'events',
    refetchInterval: tab === 'events' && isRunning ? 10_000 : false,
    refetchOnWindowFocus: false,
  })

  if (!streamId) {
    return null
  }

  // Stream not found: render a small explanation + back link instead of
  // a blank page. Common case: operator clicked an old bookmark to a
  // deleted stream.
  if (streams && !stream) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <div>
            <div className="page-title">{tDetail('notFound.title')}</div>
            <div className="page-sub">{tDetail('notFound.description')}</div>
          </div>
        </div>
        <Link
          href="/dashboard/streaming"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--txt-2)',
            textDecoration: 'none',
            fontFamily: 'var(--font-mono-app)',
            fontSize: 12,
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          {tDetail('back')}
        </Link>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <Link
            href="/dashboard/streaming"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--txt-3)',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono-app)',
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            <ArrowLeft className="h-3 w-3" />
            {tDetail('back')}
          </Link>
          <div className="page-title" style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            {stream?.name || tStreaming('streams.untitled')}
          </div>
          <div className="page-sub" style={{ fontFamily: 'var(--font-mono-app)', fontSize: 11 }}>
            {tDetail('idPrefix')} {streamId}
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label={tDetail('tablistLabel')}>
        {(['overview', 'logs', 'events'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`tab-btn ${tab === value ? 'active' : ''}`}
            onClick={() => setTab(value)}
          >
            <span className="tab-btn-label">{tDetail(`tabs.${value}`)}</span>
          </button>
        ))}
      </div>

      {tab === 'overview' && stream ? (
        <LiveStreamHero
          stream={stream}
          onStop={isRunning ? () => stopMutation.mutate() : undefined}
          onRestart={() => startMutation.mutate()}
          isStopping={stopMutation.isPending}
          isRestarting={startMutation.isPending}
        />
      ) : null}

      {tab === 'logs' ? (
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono-app)',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.16em',
                color: 'var(--txt-3)',
              }}
            >
              {tDetail('logs.title')}{' '}
              <span style={{ color: 'var(--txt-2)' }}>· {logs?.logs?.length ?? 0}</span>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['important', 'raw'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={logsMode === mode}
                  onClick={() => setLogsMode(mode)}
                  style={{
                    appearance: 'none',
                    background: logsMode === mode ? 'rgba(255,255,255,0.06)' : 'transparent',
                    border: '1px solid var(--border)',
                    color: logsMode === mode ? 'var(--txt)' : 'var(--txt-3)',
                    fontFamily: 'var(--font-mono-app)',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    padding: '4px 10px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                  }}
                >
                  {tDetail(`logs.modes.${mode}`)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => refetchLogs()}
                aria-label={tDetail('logs.refresh')}
                style={{
                  appearance: 'none',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--txt-2)',
                  padding: '4px 10px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'var(--font-mono-app)',
                  fontSize: 10,
                }}
              >
                <RefreshCcw className="h-3 w-3" />
              </button>
            </div>
          </header>
          <pre
            style={{
              fontFamily: 'var(--font-mono-app)',
              fontSize: 11,
              lineHeight: 1.55,
              color: 'var(--txt-2)',
              margin: 0,
              padding: 14,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              maxHeight: 480,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {logsLoading
              ? tDetail('logs.loading')
              : logs?.logs?.length
                ? logs.logs.join('\n')
                : tDetail('logs.empty')}
          </pre>
        </section>
      ) : null}

      {tab === 'events' ? (
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono-app)',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.16em',
                color: 'var(--txt-3)',
              }}
            >
              {tDetail('events.title')}{' '}
              <span style={{ color: 'var(--txt-2)' }}>· {events?.length ?? 0}</span>
            </span>
            <button
              type="button"
              onClick={() => refetchEvents()}
              aria-label={tDetail('events.refresh')}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--txt-2)',
                padding: '4px 10px',
                borderRadius: 999,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--font-mono-app)',
                fontSize: 10,
              }}
            >
              <RefreshCcw className="h-3 w-3" />
            </button>
          </header>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              maxHeight: 520,
              overflowY: 'auto',
            }}
          >
            {eventsLoading ? (
              <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>
                {tHero('timeline.loading')}
              </span>
            ) : events?.length ? (
              events.map((event) => (
                <article
                  key={event.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '140px 56px 1fr',
                    alignItems: 'baseline',
                    gap: 12,
                    fontFamily: 'var(--font-mono-app)',
                    fontSize: 12,
                    padding: '6px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  <time
                    dateTime={event.created_at}
                    style={{ color: 'var(--txt-3)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {fmtTimestamp(event.created_at)}
                  </time>
                  <span
                    style={{
                      color: LEVEL_COLOR[event.level],
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                    }}
                  >
                    {tHero(
                      `timeline.level${event.level.charAt(0).toUpperCase() + event.level.slice(1)}` as
                        | 'timeline.levelError'
                        | 'timeline.levelWarn'
                        | 'timeline.levelInfo'
                        | 'timeline.levelDebug',
                    )}
                  </span>
                  <span
                    style={{
                      color: 'var(--txt)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      lineHeight: 1.4,
                    }}
                  >
                    {event.message}
                  </span>
                </article>
              ))
            ) : (
              <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>
                {tHero('timeline.emptyFresh')}
              </span>
            )}
          </div>
        </section>
      ) : null}
    </div>
  )
}
