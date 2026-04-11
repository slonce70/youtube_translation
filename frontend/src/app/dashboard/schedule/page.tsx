'use client'
/* eslint-disable i18next/no-literal-string */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, format } from 'date-fns'
import { uk } from 'date-fns/locale'
import { api } from '@/lib/api'
import type { Stream } from '@/lib/types'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useDashboardContext } from '../dashboard-context'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']

export default function SchedulePage() {
  const router = useRouter()
  const { user } = useDashboardContext()
  const monthDate = new Date()
  const monthStart = startOfMonth(monthDate)
  const monthEnd = endOfMonth(monthDate)

  const { data: streams, isLoading } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id, 'schedule-page'],
    queryFn: api.streams.list,
    enabled: !!user,
    refetchInterval: 10000,
  })

  const scheduledStreams = useMemo(
    () =>
      (streams ?? [])
        .filter((stream) => stream.scheduled_start_enabled && stream.scheduled_start_time)
        .sort((a, b) => Date.parse(a.scheduled_start_time ?? '') - Date.parse(b.scheduled_start_time ?? '')),
    [streams],
  )

  const days = useMemo(() => {
    const raw = eachDayOfInterval({ start: monthStart, end: monthEnd })
    const offset = ((getDay(monthStart) + 6) % 7)
    return [...Array(offset).fill(null), ...raw]
  }, [monthEnd, monthStart])

  const upcoming = scheduledStreams.slice(0, 5)

  if (!user) return <LoadingState />
  if (isLoading) return <LoadingState text="Завантажуємо розклад…" />

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="page-title">Розклад</div>
          <div className="page-sub">Плануйте трансляції наперед</div>
        </div>
        <div className="page-actions">
          <Button onClick={() => router.push('/dashboard/streaming?new=1')}>+ Запланувати стрім</Button>
        </div>
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
        <Card>
          <CardHeader>
            <CardTitle>📅 {format(monthDate, 'LLLL yyyy', { locale: uk })}</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12 }}>
              {WEEKDAYS.map((day) => (
                <div key={day} style={{ color: 'var(--txt-3)', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>{day}</div>
              ))}
              {days.map((day, index) => {
                if (!day) return <div key={`empty-${index}`} style={{ minHeight: 72 }} />
                const dayStreams = scheduledStreams.filter((stream) => isSameDay(new Date(stream.scheduled_start_time!), day))
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => {
                      if (dayStreams[0]) router.push(`/dashboard/streaming?editStream=${dayStreams[0].id}`)
                    }}
                    style={{
                      minHeight: 84,
                      borderRadius: 12,
                      border: dayStreams.length ? '1px solid rgba(99,102,241,.45)' : '1px solid var(--border)',
                      background: dayStreams.length ? 'rgba(99,102,241,.12)' : 'var(--bg-2)',
                      padding: 12,
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>{format(day, 'd')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {dayStreams.slice(0, 2).map((stream) => (
                        <div key={stream.id} style={{ fontSize: 11, color: 'var(--txt-2)' }}>
                          • {stream.name || 'Без назви'}
                        </div>
                      ))}
                      {dayStreams.length > 2 ? <div style={{ fontSize: 11, color: 'var(--indigo-lt)' }}>+{dayStreams.length - 2} ще</div> : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="dashboard-side">
          <Card className="card-sm">
            <CardTitle>Найближчі події</CardTitle>
            <CardContent className="summary-list" style={{ marginTop: 12 }}>
              {upcoming.length ? upcoming.map((stream) => (
                <div key={stream.id} className="stream-row" style={{ alignItems: 'flex-start' }}>
                  <div className="stream-thumb">🗓️</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{stream.name || 'Без назви'}</div>
                    <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{format(new Date(stream.scheduled_start_time!), 'd LLL, HH:mm', { locale: uk })}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {(stream.destinations ?? []).slice(0, 2).map((destination) => (
                        <Badge key={destination.id} variant="indigo">{destination.name}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="empty-state" style={{ padding: '24px 12px' }}>
                  <div className="empty-icon">🗓️</div>
                  <div className="empty-title">Немає запланованих подій</div>
                  <div className="empty-sub">Створіть стрім і задайте час запуску.</div>
                </div>
              )}
              <Button fullWidth onClick={() => router.push('/dashboard/streaming?new=1')}>+ Додати подію</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
