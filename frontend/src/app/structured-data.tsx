import { getTranslations } from 'next-intl/server'

import type { Locale } from '@/i18n/config'

function resolveAbsoluteUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3000'
  return new URL(normalizedPath, baseUrl).toString()
}

export async function StructuredData({
  locale,
  path = '/',
  kind = 'root',
}: {
  locale: Locale
  path?: string
  kind?: 'root' | 'dashboard' | 'admin'
}) {
  const namespace =
    kind === 'dashboard' ? 'dashboard.metadata' : kind === 'admin' ? 'admin.metadata' : 'metadata'
  const t = await getTranslations({ locale, namespace })

  const title = t('title')
  const description = t('description')
  const url = resolveAbsoluteUrl(path)

  const data = {
    '@context': 'https://schema.org',
    '@type': kind === 'root' ? 'WebSite' : 'WebApplication',
    name: title,
    description,
    inLanguage: locale,
    url,
  }

  const safeJson = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

  return (
    <script
      type="application/ld+json"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  )
}
