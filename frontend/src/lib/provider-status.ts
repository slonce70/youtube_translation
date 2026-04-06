import type { Stream } from './types'

export type ProviderStatus = 'live' | 'offline' | 'unknown' | 'stale'

export function normalizeProviderStatus(status?: string | null): ProviderStatus {
  if (status === 'live' || status === 'offline' || status === 'stale') return status
  return 'unknown'
}

export function isProviderLive(status?: string | null): boolean {
  return normalizeProviderStatus(status) === 'live'
}

export function hasProviderIssue(status?: string | null): boolean {
  const normalized = normalizeProviderStatus(status)
  return normalized === 'stale' || normalized === 'unknown'
}

export function countLiveProviders(streams: Stream[]): number {
  return streams.filter((stream) => isProviderLive(stream.provider_status)).length
}

export function getProviderStatusKey(status?: string | null): ProviderStatus {
  return normalizeProviderStatus(status)
}

export function getProviderBadgeVariant(status?: string | null): 'live' | 'idle' | 'warn' {
  switch (normalizeProviderStatus(status)) {
    case 'live':
      return 'live'
    case 'stale':
    case 'unknown':
      return 'warn'
    default:
      return 'idle'
  }
}
