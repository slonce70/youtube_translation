'use client'

import type { ReactNode } from 'react'

// Track 5b/D: a single hero-row metric tile. Six of these compose the
// status row above the workspace. RULES 3, 13, 15:
//  • RED-style headline number, no decorative composite scores.
//  • Optional sparkline for steady-state context (no axes, low opacity).
//  • Mono uppercase eyebrow so eight tiles stay legible at a glance.

interface HeroTileProps {
  label: string
  /** Big headline value. Pass as a string so the tile owns formatting. */
  value: string
  /** Inline unit ("kb/s", "fps", "%"). Rendered smaller next to value. */
  unit?: string
  /** Secondary hint ("peak 184", "last hour"). */
  sub?: string | null
  /** Severity tint for the value/sub pair (defaults to neutral fg). */
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  /** Optional sparkline element (use the Sparkline component). */
  sparkline?: ReactNode
}

const TONE_COLOR: Record<NonNullable<HeroTileProps['tone']>, string> = {
  neutral: 'var(--txt)',
  good: 'var(--green)',
  warn: 'var(--amber)',
  bad: 'var(--red)',
}

export function HeroTile({
  label,
  value,
  unit,
  sub,
  tone = 'neutral',
  sparkline,
}: HeroTileProps) {
  return (
    <div
      style={{
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono-app)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.16em',
          color: 'var(--txt-3)',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 30,
            fontWeight: 400,
            lineHeight: 1,
            letterSpacing: '-0.015em',
            color: TONE_COLOR[tone],
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        {unit ? (
          <span
            style={{
              fontFamily: 'var(--font-mono-app)',
              fontSize: 11,
              color: 'var(--txt-3)',
            }}
          >
            {unit}
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 16,
          color: 'var(--txt-3)',
          fontFamily: 'var(--font-mono-app)',
          fontSize: 11,
        }}
      >
        <span>{sub ?? ''}</span>
        {sparkline ? <span style={{ color: TONE_COLOR[tone] }}>{sparkline}</span> : null}
      </div>
    </div>
  )
}
