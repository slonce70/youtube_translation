'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

// Track 5b/D / RULE 1, 2, 4, 16: at-a-glance health pill + ticking uptime
// + concise key/Stop block. Sits at the top of the stream-detail page so
// "is it up?" answers in <2s without reading.

export type StreamHealth = 'live' | 'degraded' | 'down' | 'idle'

interface StatusStripProps {
  health: StreamHealth
  /** Stream display name; falls back to id. */
  label?: string | null
  /** Seconds the current run has been live; the strip counts up locally
   *  between refetches so the operator sees a smooth ticker. */
  liveDurationSeconds?: number | null
  /** Optional masked stream key to copy. */
  maskedKey?: string | null
  /** Live concurrent viewers from YouTube API. */
  viewers?: number | null
  /** Bitrate (kbps), latest sample. */
  bitrateKbps?: number | null
  /** Restart handler (RULE 11: no confirmation modal). */
  onRestart?: () => void
  /** Stop handler. */
  onStop?: () => void
  isStopping?: boolean
  isRestarting?: boolean
}

const HEALTH_COLOR: Record<StreamHealth, string> = {
  live: 'var(--green)',
  degraded: 'var(--amber)',
  down: 'var(--red)',
  idle: 'var(--txt-3)',
}

function formatTicker(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '—'
  }
  const total = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

function useLocalTicker(initialSeconds: number | null | undefined) {
  const [ticker, setTicker] = useState<number | null>(
    initialSeconds == null ? null : Math.max(0, Math.floor(initialSeconds)),
  )

  useEffect(() => {
    if (initialSeconds == null) {
      setTicker(null)
      return
    }
    setTicker(Math.max(0, Math.floor(initialSeconds)))
  }, [initialSeconds])

  useEffect(() => {
    if (initialSeconds == null) return
    const id = setInterval(() => {
      setTicker((current) => (current == null ? null : current + 1))
    }, 1000)
    return () => clearInterval(id)
  }, [initialSeconds])

  return ticker
}

export function StatusStrip({
  health,
  label,
  liveDurationSeconds,
  maskedKey,
  viewers,
  bitrateKbps,
  onRestart,
  onStop,
  isStopping,
  isRestarting,
}: StatusStripProps) {
  const tHero = useTranslations('streaming.hero')
  const ticker = useLocalTicker(liveDurationSeconds)
  const healthLabel = tHero(`status.${health}`)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        padding: '14px 18px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--bg-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <span
          aria-label={healthLabel}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            borderRadius: 999,
            border: `1px solid ${HEALTH_COLOR[health]}`,
            color: HEALTH_COLOR[health],
            fontFamily: 'var(--font-mono-app)',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: HEALTH_COLOR[health],
              boxShadow:
                health === 'live'
                  ? `0 0 0 0 ${HEALTH_COLOR.live}`
                  : 'none',
              animation: health === 'live' ? 'lpc-pulse 1.6s infinite' : 'none',
            }}
          />
          {healthLabel}
        </span>

        <span
          style={{
            fontFamily: 'var(--font-mono-app)',
            fontSize: 14,
            color: 'var(--txt)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatTicker(ticker)}
        </span>

        {label ? (
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              color: 'var(--txt-2)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 280,
            }}
            title={label}
          >
            {label}
          </span>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          fontFamily: 'var(--font-mono-app)',
          fontSize: 12,
          color: 'var(--txt-3)',
          fontVariantNumeric: 'tabular-nums',
          flexWrap: 'wrap',
        }}
      >
        {bitrateKbps != null && Number.isFinite(bitrateKbps) ? (
          <span>
            {Math.round(bitrateKbps).toLocaleString()} {tHero('metrics.bitrateUnit')}
          </span>
        ) : null}
        {viewers != null ? (
          <span>
            {viewers} {tHero('ticker.viewersSuffix')}
          </span>
        ) : null}
        {maskedKey ? (
          <span>
            {tHero('ticker.key')}: {maskedKey}
          </span>
        ) : null}

        {onRestart ? (
          <button
            type="button"
            onClick={onRestart}
            disabled={Boolean(isRestarting)}
            style={{
              appearance: 'none',
              border: '1px solid var(--border-lt)',
              background: 'transparent',
              color: 'var(--txt)',
              fontFamily: 'var(--font-mono-app)',
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              padding: '6px 12px',
              borderRadius: 999,
              cursor: isRestarting ? 'wait' : 'pointer',
              opacity: isRestarting ? 0.6 : 1,
            }}
          >
            {isRestarting ? tHero('actions.wait') : tHero('actions.restart')}
          </button>
        ) : null}
        {onStop ? (
          <button
            type="button"
            onClick={onStop}
            disabled={Boolean(isStopping)}
            style={{
              appearance: 'none',
              border: `1px solid ${HEALTH_COLOR.down}`,
              background: 'transparent',
              color: HEALTH_COLOR.down,
              fontFamily: 'var(--font-mono-app)',
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              padding: '6px 12px',
              borderRadius: 999,
              cursor: isStopping ? 'wait' : 'pointer',
              opacity: isStopping ? 0.6 : 1,
            }}
          >
            {isStopping ? tHero('actions.wait') : tHero('actions.stop')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
