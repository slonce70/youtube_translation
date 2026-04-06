import type { Destination, StreamDestinationSummary } from '@/lib/types'

export type DestinationPlatformPresentation = {
  kind: 'youtube' | 'twitch' | 'rtmps'
  icon: string
  label: string
  className: string
}

type DestinationPlatformInput = Pick<
  Destination | StreamDestinationSummary,
  'name' | 'rtmps_url' | 'provider_kind'
>

export function getDestinationPlatformPresentation(
  destination: DestinationPlatformInput,
): DestinationPlatformPresentation {
  const haystack = [
    destination.provider_kind ?? '',
    destination.rtmps_url ?? '',
    destination.name ?? '',
  ].join(' ').toLowerCase()

  if (
    destination.provider_kind === 'youtube' ||
    haystack.includes('youtube') ||
    haystack.includes('youtu.be') ||
    haystack.includes('googlevideo')
  ) {
    return {
      kind: 'youtube',
      icon: '▶',
      label: 'YouTube',
      className: 'channel-logo channel-logo-youtube',
    }
  }

  if (haystack.includes('twitch')) {
    return {
      kind: 'twitch',
      icon: '🎮',
      label: 'Twitch',
      className: 'channel-logo channel-logo-twitch',
    }
  }

  return {
    kind: 'rtmps',
    icon: '📡',
    label: 'RTMPS',
    className: 'channel-logo channel-logo-rtmps',
  }
}
