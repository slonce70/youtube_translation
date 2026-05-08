import type { Stream } from './types'

export type ProviderStatus = 'live' | 'offline' | 'unknown' | 'stale'
type ProviderHealthAware = {
  provider_health_status?: string | null
  provider_health_issues?: string[] | null
}

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

export function getProviderHealthIssueCount(provider?: ProviderHealthAware | null): number {
  return provider?.provider_health_issues?.length ?? 0
}

export function hasProviderHealthAttention(provider?: ProviderHealthAware | null): boolean {
  const healthStatus = provider?.provider_health_status ?? null
  return healthStatus === 'bad' || healthStatus === 'noData' || getProviderHealthIssueCount(provider) > 0
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
