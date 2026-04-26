'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import type { StreamEventResponse } from '@/lib/types'

// Track 5b/D / RULE 9: severity-tagged inline timeline that replaces the
// old "logs portal modal" flow. Persistent, glance-able, filterable by
// level. Shows up to ~50 latest events from /api/streams/<id>/events.

type SeverityFilter = 'all' | 'error' | 'warning' | 'info' | 'debug'

const LEVEL_COLOR: Record<StreamEventResponse['level'], string> = {
  error: 'var(--red)',
  warning: 'var(--amber)',
  info: 'var(--txt-2)',
  debug: 'var(--txt-3)',
}

interface IncidentTimelineProps {
  events: StreamEventResponse[] | undefined
  isLoading?: boolean
  emptyDays?: number | null
}

function fmtTime(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

export function IncidentTimeline({
  events,
  isLoading,
  emptyDays,
}: IncidentTimelineProps) {
  const tHero = useTranslations('streaming.hero')
  const [filter, setFilter] = useState<SeverityFilter>('all')

  const filtered = useMemo(() => {
    if (!events) return []
    if (filter === 'all') return events
    return events.filter((event) => event.level === filter)
  }, [events, filter])

  const levelLabel = (level: StreamEventResponse['level']) => {
    const key = `timeline.level${level.charAt(0).toUpperCase() + level.slice(1)}`
    return tHero(key as 'timeline.levelError' | 'timeline.levelWarn' | 'timeline.levelInfo' | 'timeline.levelDebug')
  }

  const filters: Array<{ value: SeverityFilter; label: string }> = [
    { value: 'all', label: tHero('timeline.filterAll') },
    { value: 'error', label: tHero('timeline.levelError') },
    { value: 'warning', label: tHero('timeline.levelWarn') },
    { value: 'info', label: tHero('timeline.levelInfo') },
  ]

  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
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
          {tHero('timeline.title')}
        </span>
        <div role="tablist" aria-label="Фільтр за рівнем" style={{ display: 'flex', gap: 4 }}>
          {filters.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              style={{
                appearance: 'none',
                background: filter === option.value ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                border: '1px solid var(--border)',
                color: filter === option.value ? 'var(--txt)' : 'var(--txt-3)',
                fontFamily: 'var(--font-mono-app)',
                fontSize: 10,
                letterSpacing: '0.12em',
                padding: '4px 10px',
                borderRadius: 999,
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxHeight: 320,
          overflowY: 'auto',
        }}
      >
        {isLoading ? (
          <div style={{ fontSize: 12, color: 'var(--txt-3)', padding: 4 }}>
            {tHero('timeline.loading')}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState days={emptyDays ?? null} filter={filter} />
        ) : (
          filtered.map((event) => (
            <article
              key={event.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '64px 56px 1fr',
                alignItems: 'baseline',
                gap: 10,
                fontFamily: 'var(--font-mono-app)',
                fontSize: 12,
                padding: '4px 0',
                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
              }}
            >
              <time
                dateTime={event.created_at}
                style={{
                  color: 'var(--txt-3)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {fmtTime(event.created_at)}
              </time>
              <span
                style={{
                  color: LEVEL_COLOR[event.level],
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                }}
              >
                {levelLabel(event.level)}
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
        )}
      </div>
    </section>
  )
}

function EmptyState({
  days,
  filter,
}: {
  days: number | null
  filter: SeverityFilter
}) {
  const tHero = useTranslations('streaming.hero')
  if (filter !== 'all') {
    return (
      <div style={{ fontSize: 12, color: 'var(--txt-3)', padding: 4 }}>
        {tHero('timeline.emptyFiltered', { level: filter.toUpperCase() })}
      </div>
    )
  }
  // RULE 17: frame "no incidents" as an achievement instead of a void.
  if (days != null && days >= 1) {
    return (
      <div style={{ fontSize: 12, color: 'var(--txt-2)', padding: 4 }}>
        {tHero('timeline.emptySteady', { days })}
      </div>
    )
  }
  return (
    <div style={{ fontSize: 12, color: 'var(--txt-3)', padding: 4 }}>
      {tHero('timeline.emptyFresh')}
    </div>
  )
}
