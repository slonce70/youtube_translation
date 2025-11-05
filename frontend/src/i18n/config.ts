export const locales = ['uk', 'ru', 'en'] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'uk'

export const localePrefix = 'never' as const

