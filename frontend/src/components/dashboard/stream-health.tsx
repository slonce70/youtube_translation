'use client'

// Shared stream-health design language (UX unification 2026-06).
// Extracted verbatim from the Mission Control overview so the streaming
// page (and any future surface) speaks the same health vocabulary: one
// 4+ state model, one pill, one global banner. i18n stays in the caller —
// these components take already-resolved labels so they aren't coupled to
// a single message namespace.

import { AlertTriangle, CalendarClock, CircleCheck, CircleOff, Loader2 } from 'lucide-react'

import type { DerivedStreamState } from '@/lib/stream-state'

export type HealthState =
  | 'healthy'
  | 'degraded'
  | 'down'
  | 'offline'
  | 'starting'
  | 'stopping'
  | 'scheduled'

export const STATE_COLOR: Record<HealthState, string> = {
  healthy: 'var(--green)',
  degraded: 'var(--amber)',
  down: 'var(--red)',
  offline: 'var(--txt-3)',
  starting: 'var(--indigo)',
  stopping: 'var(--indigo)',
  scheduled: 'var(--txt-2)',
}

export const STATE_RANK: Record<HealthState, number> = {
  down: 0,
  degraded: 1,
  starting: 2,
  stopping: 2,
  healthy: 3,
  scheduled: 4,
  offline: 5,
}

export function healthOf(derived: DerivedStreamState): HealthState {
  if (derived.isStarting) return 'starting'
  if (derived.isStopping) return 'stopping'
  if (derived.isRunning) return derived.isDegraded ? 'degraded' : 'healthy'
  if (derived.derivedStatus === 'error' || derived.requiresAttention) return 'down'
  if (derived.group === 'scheduled') return 'scheduled'
  return 'offline'
}

export function HealthPill({ state, label }: { state: HealthState; label: string }) {
  const color = STATE_COLOR[state]
  const Icon =
    state === 'healthy'
      ? CircleCheck
      : state === 'degraded' || state === 'down'
        ? AlertTriangle
        : state === 'starting' || state === 'stopping'
          ? Loader2
          : state === 'scheduled'
            ? CalendarClock
            : CircleOff
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        color,
        background: 'color-mix(in srgb, currentColor 14%, transparent)',
        padding: '3px 9px',
        borderRadius: 6,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon className={`h-3 w-3${state === 'starting' || state === 'stopping' ? ' animate-spin' : ''}`} />
      {label}
    </span>
  )
}

// Global health line shared by the overview and the streaming page so both
// surfaces open with the identical "are my streams alive?" element.
export function GlobalHealthBanner({
  attentionCount,
  runningCount,
  text,
  summary,
}: {
  attentionCount: number
  runningCount: number
  healthyCount?: number
  text: string
  summary?: string
}) {
  const tone =
    attentionCount > 0 ? 'var(--amber)' : runningCount > 0 ? 'var(--green)' : 'var(--txt-3)'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'color-mix(in srgb, ' + tone + ' 8%, transparent)',
        border: '1px solid color-mix(in srgb, ' + tone + ' 28%, transparent)',
        borderLeft: `3px solid ${tone}`,
        borderRadius: 'var(--radius)',
        padding: '12px 16px',
      }}
    >
      <span style={{ color: tone, display: 'inline-flex' }}>
        {attentionCount > 0 ? <AlertTriangle className="h-5 w-5" /> : <CircleCheck className="h-5 w-5" />}
      </span>
      <span style={{ fontWeight: 600, fontSize: 14 }}>{text}</span>
      {summary ? (
        <span className="page-sub" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {summary}
        </span>
      ) : null}
    </div>
  )
}
