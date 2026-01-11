import { applyDurationPreset, formatDateTimeLocal, parseDateTimeLocal } from '../schedule-utils'

describe('schedule utils', () => {
  it('formats datetime-local values', () => {
    const date = new Date(2026, 0, 2, 9, 5, 30)
    expect(formatDateTimeLocal(date)).toBe('2026-01-02T09:05')
  })

  it('parses datetime-local values safely', () => {
    expect(parseDateTimeLocal('')).toBeNull()
    expect(parseDateTimeLocal('not-a-date')).toBeNull()
    expect(parseDateTimeLocal('2026-02-30T09:05')).toBeNull()
    expect(parseDateTimeLocal('2026-13-02T09:05')).toBeNull()
    expect(parseDateTimeLocal('2026-01-02T24:00')).toBeNull()
    expect(parseDateTimeLocal('2026-01-02T09:05')).toBeInstanceOf(Date)
  })

  it('applies duration presets based on schedule mode', () => {
    const base = '2026-01-02T09:00'
    const result = applyDurationPreset({ startMode: 'schedule', startAt: base, stopAt: '' }, 12)
    expect(result.stopAt).toBe('2026-01-02T21:00')

    const resultNoStart = applyDurationPreset({ startMode: 'schedule', startAt: '', stopAt: '' }, 12)
    expect(resultNoStart.startAt).toBeTruthy()
    expect(resultNoStart.stopAt).toBeTruthy()
  })

  it('uses current time when startMode is now', () => {
    jest.useFakeTimers()
    try {
      jest.setSystemTime(new Date(2026, 0, 2, 9, 0, 0))
      const result = applyDurationPreset({ startMode: 'now', startAt: '', stopAt: '' }, 12)
      expect(result.stopAt).toBe('2026-01-02T21:00')
    } finally {
      jest.useRealTimers()
    }
  })

  it('handles day rollover when applying a duration preset', () => {
    const base = '2026-01-02T23:30'
    const result = applyDurationPreset({ startMode: 'schedule', startAt: base, stopAt: '' }, 2)
    expect(result.stopAt).toBe('2026-01-03T01:30')
  })
})

