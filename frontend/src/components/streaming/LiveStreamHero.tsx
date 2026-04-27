'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { api } from '@/lib/api'
import type {
  Stream,
  StreamEventResponse,
  StreamLiveMetrics,
  StreamStatusResponse,
} from '@/lib/types'
import { useStreamFavicon } from '@/lib/useStreamFavicon'
import { useStreamTabTitle } from '@/lib/useStreamTabTitle'

import { HeroTile } from './HeroTile'
import { IncidentTimeline } from './IncidentTimeline'
import { NowPlayingPanel } from './NowPlayingPanel'
import { Sparkline } from './Sparkline'
import { StatusStrip, type StreamHealth } from './StatusStrip'

// Track 5b/D: per-stream "modern operator hero" that composes the new
// surfaces (status strip + 6 hero tiles + now-playing + incident
// timeline) into the live tab of /dashboard/streaming. Drops into the
// existing page so the rebuild is additive and falls back to the
// original card UI if the panel can't fetch the new data yet.

interface LiveStreamHeroProps {
  stream: Stream
  /** Optional status override; if omitted, the hero self-fetches via
   *  ``GET /api/streams/<id>/status`` at a 5-second cadence while the
   *  stream is running. Polling pauses on hidden tabs by React-Query
   *  default behavior. */
  status?: StreamStatusResponse
  /** When true, the stream-name label in the StatusStrip becomes a
   *  link to ``/dashboard/streams/<id>``. Set on list pages where the
   *  hero is rendered for navigation; suppressed on the detail page
   *  itself to avoid linking to the page already showing. */
  linkToDetail?: boolean
  isStopping?: boolean
  isRestarting?: boolean
  onRestart?: () => void
  onStop?: () => void
}

function deriveHealth(stream: Stream, status: StreamStatusResponse | undefined): StreamHealth {
  const summary = status?.runtime_incident_summary ?? stream.runtime_incident_summary
  const severity = summary?.severity
  const restartState = stream.runtime_restart?.state
  if (severity === 'critical' || stream.status === 'error') return 'down'
  if (severity === 'degraded' || restartState === 'retrying' || restartState === 'exhausted') {
    return 'degraded'
  }
  if (status?.is_running || stream.status === 'running') return 'live'
  return 'idle'
}

export function LiveStreamHero({
  stream,
  status: statusOverride,
  linkToDetail = false,
  isStopping,
  isRestarting,
  onRestart,
  onStop,
}: LiveStreamHeroProps) {
  const { data: fetchedStatus } = useQuery<StreamStatusResponse>({
    queryKey: ['stream-status', stream.id, 'hero'],
    queryFn: () => api.streams.status(stream.id),
    enabled: Boolean(stream.id) && !statusOverride,
    refetchInterval: stream.status === 'running' ? 5_000 : 30_000,
    refetchOnWindowFocus: false,
  })
  const status = statusOverride ?? fetchedStatus
  const isRunning = status?.is_running ?? stream.status === 'running'
  const health = deriveHealth(stream, status)
  const tHero = useTranslations('streaming.hero')

  // Tab title + favicon: turn the pinned tab into the monitoring
  // surface — green/amber/red dot + state prefix in the title.
  // Multi-stream pages: each hero mounts its own hook; whichever
  // re-renders last wins, but for the common single-stream case the
  // signal is correct and stable.
  useStreamTabTitle(health, stream.name || 'YouTube Streaming')
  useStreamFavicon(health)

  const { data: events, isLoading: eventsLoading } = useQuery<StreamEventResponse[]>({
    queryKey: ['stream-events', stream.id],
    queryFn: () => api.streams.events(stream.id, { limit: 50 }),
    enabled: Boolean(stream.id),
    refetchInterval: isRunning ? 10_000 : 60_000,
    refetchOnWindowFocus: false,
  })

  // Live FFmpeg-stderr metrics: only poll while the stream is actually
  // running. The status payload already includes a snapshot, but a
  // dedicated 5-second cadence drives smoother sparkline updates.
  const { data: metricsFromEndpoint } = useQuery<StreamLiveMetrics>({
    queryKey: ['stream-metrics', stream.id],
    queryFn: () => api.streams.metrics(stream.id, { samples: 60 }),
    enabled: Boolean(stream.id) && isRunning,
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
  })

  const metrics = metricsFromEndpoint ?? status?.live_metrics ?? null
  const playback = status?.playback ?? null

  const bitrateSeries = useMemo(
    () => (metrics?.samples ?? []).map((sample) => sample.bitrate_kbps ?? null),
    [metrics?.samples],
  )
  const fpsSeries = useMemo(
    () => (metrics?.samples ?? []).map((sample) => sample.fps ?? null),
    [metrics?.samples],
  )
  const dropSeries = useMemo(
    () => (metrics?.samples ?? []).map((sample) => sample.dropped_frames ?? null),
    [metrics?.samples],
  )

  const queueRemainingSeconds = playback?.queue_remaining_seconds ?? 0
  const queueRemainingHuman = useMemo(() => {
    if (!queueRemainingSeconds) return '0m'
    const total = Math.max(0, Math.floor(queueRemainingSeconds))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }, [queueRemainingSeconds])

  const droppedTotal = metrics?.dropped_frames_total ?? 0
  const reconnectCount = metrics?.reconnect_count_24h ?? 0
  const dropTone = droppedTotal > 0 ? 'warn' : 'good'
  const reconnectTone = reconnectCount > 2 ? 'warn' : 'good'

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
      <StatusStrip
        health={health}
        label={stream.name}
        labelHref={linkToDetail ? `/dashboard/streams/${stream.id}` : null}
        liveDurationSeconds={status?.live_duration_seconds ?? status?.uptime_seconds ?? null}
        viewers={status?.provider_viewers ?? null}
        bitrateKbps={metrics?.bitrate_kbps ?? null}
        onRestart={onRestart}
        onStop={onStop}
        isStopping={isStopping}
        isRestarting={isRestarting}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 12,
        }}
      >
        <HeroTile
          label={tHero('metrics.bitrate')}
          value={
            metrics?.bitrate_kbps != null
              ? Math.round(metrics.bitrate_kbps).toLocaleString()
              : '—'
          }
          unit={tHero('metrics.bitrateUnit')}
          sub={
            metrics?.samples?.length
              ? tHero('metrics.samplesCount', { count: metrics.samples.length })
              : tHero('metrics.samplesAwaiting')
          }
          sparkline={<Sparkline data={bitrateSeries} />}
        />
        <HeroTile
          label={tHero('metrics.fps')}
          value={metrics?.fps != null ? metrics.fps.toFixed(1) : '—'}
          unit={tHero('metrics.fpsUnit')}
          sub={tHero('metrics.fpsTarget')}
          sparkline={<Sparkline data={fpsSeries} />}
        />
        <HeroTile
          label={tHero('metrics.drops')}
          value={droppedTotal.toLocaleString()}
          unit={tHero('metrics.framesUnit')}
          sub={
            droppedTotal > 0
              ? tHero('metrics.dropsAlertState')
              : tHero('metrics.dropsCleanState')
          }
          tone={dropTone}
          sparkline={<Sparkline data={dropSeries} />}
        />
        <HeroTile
          label={tHero('metrics.reconnects')}
          value={reconnectCount.toLocaleString()}
          unit={tHero('metrics.in24h')}
          sub={
            reconnectCount > 0
              ? tHero('metrics.reconnectAlert')
              : tHero('metrics.reconnectClean')
          }
          tone={reconnectTone}
        />
        <HeroTile
          label={tHero('metrics.viewers')}
          value={
            status?.provider_viewers != null ? status.provider_viewers.toLocaleString() : '—'
          }
          unit={tHero('metrics.online')}
          sub={
            status?.provider_status === 'live'
              ? tHero('metrics.ytLive')
              : tHero('metrics.ytWaiting')
          }
          tone={status?.provider_status === 'live' ? 'good' : 'neutral'}
        />
        <HeroTile
          label={tHero('metrics.queue')}
          value={
            playback?.queue_remaining_count != null
              ? playback.queue_remaining_count.toLocaleString()
              : '—'
          }
          unit={tHero('metrics.queueUnit')}
          sub={`${queueRemainingHuman}${playback?.loop_enabled ? ` · ${tHero('metrics.loop')}` : ''}`}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)',
          gap: 16,
        }}
      >
        <NowPlayingPanel
          playback={playback}
          liveDurationSeconds={status?.live_duration_seconds ?? status?.uptime_seconds ?? null}
        />
        <IncidentTimeline events={events} isLoading={eventsLoading} />
      </div>
    </section>
  )
}
