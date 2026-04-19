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
  const isLiveLike = stream.status === 'running' || stream.status === 'starting'
  if (!isLiveLike) {
    return { kind: 'unavailable', videoId: null }
  }

  if (stream.provider_video_id) {
    return { kind: 'ready', videoId: stream.provider_video_id }
  }

  return { kind: 'pending', videoId: null }
}

export function getStreamPreviewEmbedUrl(stream: Stream): string | null {
  const preview = getStreamPreviewState(stream)
  return preview.kind === 'ready' ? buildYouTubeEmbedUrl(preview.videoId) : null
}
