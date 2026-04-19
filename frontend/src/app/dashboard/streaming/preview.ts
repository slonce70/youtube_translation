import type { Stream } from '@/lib/types'

export type StreamPreviewState =
  | { kind: 'ready'; videoId: string }
  | { kind: 'pending'; videoId: null }
  | { kind: 'unavailable'; videoId: null }

export function buildYouTubeEmbedUrl(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    playsinline: '1',
    rel: '0',
  })

  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`
}

export function getStreamPreviewState(stream: Stream): StreamPreviewState {
  if (stream.provider_video_id) {
    return { kind: 'ready', videoId: stream.provider_video_id }
  }

  if (stream.status === 'running' || stream.status === 'starting') {
    return { kind: 'pending', videoId: null }
  }

  return { kind: 'unavailable', videoId: null }
}
