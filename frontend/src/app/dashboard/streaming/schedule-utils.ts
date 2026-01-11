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
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hours = Number(match[4])
  const minutes = Number(match[5])

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return null
  }

  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (hours < 0 || hours > 23) return null
  if (minutes < 0 || minutes > 59) return null

  const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0)
  if (Number.isNaN(parsed.getTime())) return null
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hours ||
    parsed.getMinutes() !== minutes
  ) {
    return null
  }
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

