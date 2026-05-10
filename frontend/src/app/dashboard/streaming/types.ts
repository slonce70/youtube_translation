import type { TranslationValues } from 'next-intl'

export const YOUTUBE_DEFAULT_RTMPS_URL = 'rtmps://a.rtmps.youtube.com/live2'

export type DestinationFormState = {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
  provider_connection_id: string | null
}

export type TranslationFn = (key: string, values?: TranslationValues) => string
