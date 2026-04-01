import { getRequestConfig } from 'next-intl/server'
import { headers } from 'next/headers'

import { defaultLocale, locales, type Locale } from './config'
import { loadMessages } from '../messages'

export default getRequestConfig(async () => {
  const headerList = await headers()
  const localeFromHeaders = headerList.get('x-next-intl-locale') as Locale | null
  const resolvedLocale = localeFromHeaders && locales.includes(localeFromHeaders)
    ? localeFromHeaders
    : defaultLocale

  return {
    locale: resolvedLocale,
    messages: await loadMessages(resolvedLocale),
    timeZone: 'Europe/Kyiv',
  }
})
