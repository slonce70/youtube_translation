import { getLocale, getTranslations } from 'next-intl/server'

import type { Locale } from './config'

export async function resolveLocale(): Promise<Locale> {
  const locale = (await getLocale()) as Locale | undefined
  return locale ?? 'uk'
}

export async function getScopedTranslations(namespace?: string) {
  const locale = await resolveLocale()
  const t = await getTranslations(namespace ? namespace : undefined)
  return { locale, t }
}

