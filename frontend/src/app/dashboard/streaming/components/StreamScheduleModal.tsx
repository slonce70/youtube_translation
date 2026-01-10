'use client'

import { useEffect, useMemo, useState } from 'react'
import type { TranslationValues } from 'next-intl'
import { AlertTriangle, Clock3, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import type { Stream } from '@/lib/types'
import { applyDurationPreset, DURATION_PRESETS, formatDateTimeLocal } from '../schedule-utils'

type Translator = (key: string, values?: TranslationValues) => string

type ScheduleDraft = {
  startMode: 'now' | 'schedule'
  startAt: string
  stopAt: string
}

type StreamScheduleModalProps = {
  open: boolean
  stream: Stream | null
  t: Translator
  onClose: () => void
  onSave: (draft: ScheduleDraft) => void
  isSaving?: boolean
}

export function StreamScheduleModal({
  open,
  stream,
  t,
  onClose,
  onSave,
  isSaving = false,
}: StreamScheduleModalProps) {
  const [draft, setDraft] = useState<ScheduleDraft>({
    startMode: 'now',
    startAt: '',
    stopAt: '',
  })

  useEffect(() => {
    if (!open || !stream) return
    const startMode = stream.scheduled_start_enabled ? 'schedule' : 'now'
    const startAt = stream.scheduled_start_time ? formatDateTimeLocal(new Date(stream.scheduled_start_time)) : ''
    const stopAt = stream.scheduled_stop_time ? formatDateTimeLocal(new Date(stream.scheduled_stop_time)) : ''
    setDraft({ startMode, startAt, stopAt })
  }, [open, stream])

  const isRunning = useMemo(() => {
    if (!stream) return false
    return ['running', 'starting', 'stopping'].includes(stream.status)
  }, [stream])

  if (!open || !stream) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
      <Card className="w-full max-w-xl animate-scale-in">
        <CardHeader className="flex items-start justify-between space-y-0">
          <div>
            <CardTitle>{t('streams.scheduleModal.title')}</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('streams.scheduleModal.description')}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('streams.scheduleModal.close')}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('streams.builder.schedule.title')}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={draft.startMode === 'now' ? 'primary' : 'secondary'}
                onClick={() => setDraft((prev) => ({ ...prev, startMode: 'now' }))}
                disabled={isSaving}
              >
                {t('streams.builder.schedule.startNow')}
              </Button>
              <Button
                size="sm"
                variant={draft.startMode === 'schedule' ? 'primary' : 'secondary'}
                onClick={() => setDraft((prev) => ({ ...prev, startMode: 'schedule' }))}
                disabled={isRunning || isSaving}
              >
                {t('streams.builder.schedule.startLater')}
              </Button>
            </div>
            {isRunning && (
              <p className="text-xs text-amber-600 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {t('streams.scheduleModal.runningHint')}
              </p>
            )}
            {draft.startMode === 'schedule' && (
              <Input
                type="datetime-local"
                value={draft.startAt}
                onChange={(event) => setDraft((prev) => ({ ...prev, startAt: event.target.value }))}
                disabled={isRunning || isSaving}
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('streams.builder.schedule.stopLabel')}
            </label>
            <Input
              type="datetime-local"
              value={draft.stopAt}
              onChange={(event) => setDraft((prev) => ({ ...prev, stopAt: event.target.value }))}
              disabled={isSaving}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('streams.builder.schedule.stopHint')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {t('streams.builder.schedule.durationLabel')}
              </span>
              {DURATION_PRESETS.map((hours) => (
                <Button
                  key={`schedule-duration-${hours}`}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      ...applyDurationPreset(prev, hours),
                    }))
                  }
                  disabled={isSaving}
                >
                  <Clock3 className="mr-1 h-4 w-4" />
                  {t(`streams.builder.schedule.durationOptions.${hours}h`)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
              {t('streams.scheduleModal.cancel')}
            </Button>
            <Button type="button" onClick={() => onSave(draft)} isLoading={isSaving}>
              {t('streams.scheduleModal.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

