import { formatDistanceToNow } from 'date-fns'
import type { Locale as DateFnsLocale } from 'date-fns'
import { enUS, ru, uk as ukLocale } from 'date-fns/locale'

const DATE_FNS_LOCALES: Record<string, DateFnsLocale> = {
  en: enUS,
  ru,
  uk: ukLocale,
}

export function getDateLocale(locale?: string | null): DateFnsLocale {
  if (!locale) return enUS
  return DATE_FNS_LOCALES[locale] ?? enUS
}

export function formatRelativeDateTime(
  value: string | null | undefined,
  locale?: string | null,
  fallback = '—',
): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback

  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: getDateLocale(locale),
  })
}

export function formatAbsoluteDateTime(
  value: string | null | undefined,
  locale?: string | null,
  fallback = '—',
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback

  return new Intl.DateTimeFormat(locale ?? 'en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  }).format(date)
}
