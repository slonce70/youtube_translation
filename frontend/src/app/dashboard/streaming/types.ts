import type { TranslationValues } from 'next-intl'

export type DestinationFormState = {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
  provider_connection_id: string | null
}

export type TranslationFn = (key: string, values?: TranslationValues) => string
