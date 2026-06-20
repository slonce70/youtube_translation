import { RadioTower, Twitch, Youtube } from 'lucide-react'

import { getDestinationPlatformPresentation } from '../platform'

describe('getDestinationPlatformPresentation', () => {
  it('maps YouTube provider fields to the prototype red play tile', () => {
    expect(
      getDestinationPlatformPresentation({
        name: 'Main channel',
        rtmps_url: 'rtmps://a.rtmp.youtube.com/live2',
        provider_kind: 'youtube',
      }),
    ).toMatchObject({
      kind: 'youtube',
      icon: Youtube,
      className: 'channel-logo channel-logo-youtube',
    })
  })

  it('maps Twitch URLs to the prototype purple game tile', () => {
    expect(
      getDestinationPlatformPresentation({
        name: 'Reserve',
        rtmps_url: 'rtmps://live.twitch.tv/app',
        provider_kind: null,
      }),
    ).toMatchObject({
      kind: 'twitch',
      icon: Twitch,
      className: 'channel-logo channel-logo-twitch',
    })
  })

  it('falls back to a generic RTMPS tile', () => {
    expect(
      getDestinationPlatformPresentation({
        name: 'Custom RTMPS',
        rtmps_url: 'rtmps://example.com/live',
        provider_kind: null,
      }),
    ).toMatchObject({
      kind: 'rtmps',
      icon: RadioTower,
      className: 'channel-logo channel-logo-rtmps',
    })
  })
})
