import type { AbstractIntlMessages } from 'next-intl'

import type { Locale } from '../i18n/config'

const loaders: Record<Locale, () => Promise<AbstractIntlMessages>> = {
  uk: () => import('./uk').then((mod) => mod.default as unknown as AbstractIntlMessages),
  ru: () => import('./ru').then((mod) => mod.default as unknown as AbstractIntlMessages),
  en: () => import('./en').then((mod) => mod.default as unknown as AbstractIntlMessages),
}

export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  const loader = loaders[locale]
  if (!loader) {
    throw new Error(`Unsupported locale: ${locale}`)
  }

  return loader()
}
