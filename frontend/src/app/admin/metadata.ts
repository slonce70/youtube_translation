import type { Metadata, ResolvingMetadata } from 'next'
import { getLocale } from 'next-intl/server'

import type { Locale } from '@/i18n/config'
import { buildMetadata } from '../metadata'

export async function generateMetadata(_props: unknown, _parent?: ResolvingMetadata): Promise<Metadata> {
  const locale = (await getLocale()) as Locale
  return buildMetadata({ locale, kind: 'admin', path: '/admin' })
}
