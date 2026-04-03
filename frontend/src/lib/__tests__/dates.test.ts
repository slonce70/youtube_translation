import { formatAbsoluteDateTime, formatRelativeDateTime, getDateLocale } from '../dates'

describe('dates helpers', () => {
  it('returns a locale object for supported locales', () => {
    expect(getDateLocale('uk')).toBeDefined()
    expect(getDateLocale('ru')).toBeDefined()
    expect(getDateLocale('en')).toBeDefined()
  })

  it('formats absolute datetimes with the provided locale', () => {
    const formatted = formatAbsoluteDateTime('2026-01-15T13:45:00Z', 'uk', '—', { timeZone: 'UTC' })

    expect(formatted).toMatch(/2026/)
    expect(formatted).not.toContain('Jan')
  })

  it('returns fallback for invalid values', () => {
    expect(formatAbsoluteDateTime('bad-date', 'en')).toBe('—')
    expect(formatRelativeDateTime('bad-date', 'en')).toBe('—')
  })
})
