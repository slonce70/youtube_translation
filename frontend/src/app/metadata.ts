import { getTranslations } from 'next-intl/server'

import { defaultLocale, locales, type Locale } from '@/i18n/config'

type MetadataKind = 'root' | 'dashboard' | 'admin'

export async function buildMetadata({
  locale,
  kind = 'root',
  path = '/',
}: {
  locale: Locale
  kind?: MetadataKind
  path?: string
}) {
  const namespace = kind === 'dashboard' ? 'dashboard.metadata' : kind === 'admin' ? 'admin.metadata' : 'metadata'
  const t = await getTranslations({ locale, namespace })

  const title = t('title')
  const description = t('description')

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const baseLanguages = locales.reduce<Record<string, string>>((acc, item) => {
    const base = normalizedPath === '/' ? '/' : normalizedPath.replace(/\/$/, '')
    acc[item] = item === defaultLocale ? base : `${base}?locale=${item}`
    return acc
  }, {})

  return {
    title,
    description,
    alternates: {
      canonical: baseLanguages[locale] ?? normalizedPath,
      languages: baseLanguages,
    },
    openGraph: {
      title,
      description,
      locale,
      alternateLocale: locales.filter((code) => code !== locale),
    },
  }
}
