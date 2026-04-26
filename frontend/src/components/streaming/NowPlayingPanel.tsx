'use client'

import { useTranslations } from 'next-intl'

import type { StreamPlaybackInfo } from '@/lib/types'

// Track 5b/D / RULE 12: answer "what's on air right now?" with a thumbnail
// (here, a typographic glyph since we don't generate per-asset thumbnails
// yet), the current asset filename, time-remaining bar, and the next-up
// label. No drag-reorder yet — that lands when the backend exposes a
// reorder API. For 24/7 looping channels this is the most-requested
// surface (see docs/operations/first_stream_walkthrough.md gap #8).

interface NowPlayingPanelProps {
  playback: StreamPlaybackInfo | null | undefined
  /** Seconds since stream start; used to estimate progress through the
   *  current asset when the backend hasn't surfaced a position yet. */
  liveDurationSeconds?: number | null
  className?: string
}

function fmtDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '—'
  }
  const total = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function deriveProgress(
  playback: StreamPlaybackInfo | null | undefined,
  liveDurationSeconds?: number | null,
): { offsetSeconds: number; totalSeconds: number; ratio: number } {
  const total = Math.max(playback?.current?.duration_seconds ?? 0, 0)
  if (!total || liveDurationSeconds == null) {
    return { offsetSeconds: 0, totalSeconds: total, ratio: 0 }
  }
  const offset = Math.max(0, liveDurationSeconds % total)
  return {
    offsetSeconds: offset,
    totalSeconds: total,
    ratio: total > 0 ? offset / total : 0,
  }
}

export function NowPlayingPanel({
  playback,
  liveDurationSeconds,
  className,
}: NowPlayingPanelProps) {
  const tHero = useTranslations('streaming.hero')
  const current = playback?.current ?? null
  const next = playback?.next ?? null
  const { offsetSeconds, totalSeconds, ratio } = deriveProgress(playback, liveDurationSeconds)
  const ratioPercent = Math.min(100, Math.max(0, ratio * 100))
  const queueRemaining = playback?.queue_remaining_count ?? 0
  const loop = Boolean(playback?.loop_enabled)

  return (
    <section
      className={className}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        minWidth: 0,
      }}
    >
      <header
        style={{
          fontFamily: 'var(--font-mono-app)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.16em',
          color: 'var(--txt-3)',
        }}
      >
        {tHero('nowPlaying.title')}
      </header>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: 56,
            height: 56,
            border: '1px solid var(--border)',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            color: 'var(--txt-2)',
            background: 'var(--bg-2)',
          }}
        >
          {current?.filename ? current.filename.charAt(0).toUpperCase() : '·'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              lineHeight: 1.1,
              color: 'var(--txt)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={current?.filename ?? tHero('nowPlaying.waiting')}
          >
            {current?.filename ?? tHero('nowPlaying.waiting')}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono-app)',
              fontSize: 12,
              color: 'var(--txt-3)',
              marginTop: 4,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtDuration(offsetSeconds)} / {fmtDuration(totalSeconds || null)}
          </div>
        </div>
      </div>

      <div
        style={{
          height: 4,
          background: 'rgba(255, 255, 255, 0.06)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${ratioPercent}%`,
            background: 'var(--indigo)',
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      <footer
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'var(--font-mono-app)',
          fontSize: 11,
          color: 'var(--txt-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
        }}
      >
        <span>
          {tHero('nowPlaying.next')}:{' '}
          <span style={{ color: 'var(--txt-2)' }}>{next?.filename ?? '—'}</span>
        </span>
        <span>
          {tHero('nowPlaying.queueSummary', {
            count: queueRemaining,
            loop: loop ? tHero('nowPlaying.loopOn') : tHero('nowPlaying.loopOff'),
          })}
        </span>
      </footer>
    </section>
  )
}
