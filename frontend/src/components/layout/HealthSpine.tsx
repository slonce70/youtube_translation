'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import type { Stream } from '@/lib/types'
import { deriveStreamState } from '@/lib/stream-state'

type SpineTone = 'live' | 'degraded' | 'error' | 'starting' | 'idle'

interface SpineSegment {
  id: string
  name: string
  tone: SpineTone
}

function deriveSpineTone(stream: Stream): SpineTone {
  const state = deriveStreamState(stream)
  if (state.isTransitioning) return 'starting'
  if (state.derivedStatus === 'error') return 'error'
  if (state.isRunning) return state.isDegraded ? 'degraded' : 'live'
  // Non-running streams that still need eyes on them read as a warning.
  if (state.requiresAttention) return 'error'
  return 'idle'
}

/**
 * Stream health spine: a thin full-width bar with one equal-width segment per
 * stream, colored by derived stream state. Hovering a segment surfaces a small
 * mini-card with the stream name and a localized status label. Read-only — it
 * consumes whatever streams the caller already has cached.
 */
export function HealthSpine({ streams }: { streams: Stream[] }) {
  const health = useTranslations('nav.health')

  const segments = useMemo<SpineSegment[]>(
    () =>
      streams.map((stream) => ({
        id: stream.id,
        name: stream.name?.trim() || stream.id.slice(0, 8),
        tone: deriveSpineTone(stream),
      })),
    [streams],
  )

  if (segments.length === 0) {
    // Render a single faint full-width track so the spine slot stays present
    // (stable layout) even with no streams.
    return <div className="health-spine health-spine-empty" aria-hidden="true" />
  }

  return (
    <div
      className="health-spine"
      role="img"
      aria-label={health('ariaLabel', { count: segments.length })}
    >
      {segments.map((segment) => (
        <div
          key={segment.id}
          className={`health-seg health-seg-${segment.tone}`}
          title={segment.name}
        >
          <span className="health-seg-card" role="presentation">
            <span className="health-seg-card-name">{segment.name}</span>
            <span className="health-seg-card-status">{health(`status.${segment.tone}`)}</span>
          </span>
        </div>
      ))}
    </div>
  )
}
