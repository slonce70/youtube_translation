export type ScheduleMode = 'now' | 'schedule'

export type ScheduleDraft = {
  startMode: ScheduleMode
  startAt: string
  stopAt: string
}

const pad = (value: number) => value.toString().padStart(2, '0')

export const formatDateTimeLocal = (date: Date): string => {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const parseDateTimeLocal = (value: string): Date | null => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export const addHours = (date: Date, hours: number): Date => {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

export const resolveScheduleBaseDate = (startMode: ScheduleMode, startAt: string): Date => {
  if (startMode === 'schedule') {
    const parsed = parseDateTimeLocal(startAt)
    if (parsed) return parsed
  }
  return new Date()
}

export const applyDurationPreset = (draft: ScheduleDraft, hours: number): Partial<ScheduleDraft> => {
  const base = resolveScheduleBaseDate(draft.startMode, draft.startAt)
  const nextStopAt = formatDateTimeLocal(addHours(base, hours))
  if (draft.startMode === 'schedule' && !draft.startAt) {
    return {
      startAt: formatDateTimeLocal(base),
      stopAt: nextStopAt,
    }
  }
  return { stopAt: nextStopAt }
}

export const DURATION_PRESETS = [12, 24, 48]

