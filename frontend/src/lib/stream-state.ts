import type { UseQueryResult } from '@tanstack/react-query'

import type {
  Stream,
  StreamRuntimeRestartInfo,
  StreamStatusResponse,
  StreamStatusValue,
} from './types'
import { hasProviderHealthAttention } from './provider-status'

export type StreamGroup = 'live' | 'transitioning' | 'attention' | 'scheduled' | 'stopped'
export type StreamPrimaryAction = 'stop' | 'start' | 'edit_schedule' | 'view_issue' | 'pending'

export type StreamStatusQuery = Pick<
  UseQueryResult<StreamStatusResponse>,
  'data' | 'dataUpdatedAt' | 'isError' | 'isFetching'
>

export type DerivedStreamState = {
  derivedStatus: StreamStatusValue
  isRunning: boolean
  isStarting: boolean
  isStopping: boolean
  isTransitioning: boolean
  statusUnavailable: boolean
  statusFetching: boolean
  liveDurationSeconds: number | null
  totalDurationSeconds: number | null
  remainingDailySeconds: number | null
  quotaReached: boolean
  runtimeRestart: StreamRuntimeRestartInfo
  effectiveErrorMessage: string | null
  group: StreamGroup
  primaryAction: StreamPrimaryAction
  requiresAttention: boolean
}

export function getStreamPriority(state: Pick<DerivedStreamState, 'isRunning' | 'requiresAttention' | 'derivedStatus'>): number {
  if (state.isRunning || state.derivedStatus === 'starting' || state.derivedStatus === 'stopping') return 3
  if (state.requiresAttention) return 2
  if (state.derivedStatus === 'scheduled') return 1
  return 0
}

export function deriveStreamState(
  stream: Stream,
  statusQuery?: StreamStatusQuery,
  nowMs = Date.now(),
): DerivedStreamState {
  const statusData = statusQuery?.data
  const derivedStatus = statusData?.status ?? stream.status
  const isRunning = statusData?.is_running ?? stream.status === 'running'
  const isStarting = derivedStatus === 'starting'
  const isStopping = derivedStatus === 'stopping'
  const isTransitioning = isStarting || isStopping
  const statusUpdatedAtMs = statusQuery?.dataUpdatedAt ?? 0
  const statusAgeSeconds =
    isRunning && statusUpdatedAtMs > 0
      ? Math.max(Math.floor((nowMs - statusUpdatedAtMs) / 1000), 0)
      : 0

  const startedAtMs = stream.started_at ? new Date(stream.started_at).getTime() : null
  const statusLiveSeconds =
    typeof statusData?.live_duration_seconds === 'number' ? statusData.live_duration_seconds : null
  const liveDurationSeconds = isRunning
    ? statusLiveSeconds != null
      ? statusLiveSeconds + statusAgeSeconds
      : startedAtMs != null
        ? Math.max(Math.floor((nowMs - startedAtMs) / 1000), 0)
        : null
    : null

  const storedTotalSeconds = typeof stream.total_duration_seconds === 'number' ? stream.total_duration_seconds : 0
  const statusTotalSeconds =
    typeof statusData?.total_duration_seconds === 'number' ? statusData.total_duration_seconds : null
  let totalDurationSeconds = statusTotalSeconds ?? storedTotalSeconds
  if (isRunning) {
    totalDurationSeconds =
      statusTotalSeconds != null
        ? statusTotalSeconds + statusAgeSeconds
        : storedTotalSeconds + (liveDurationSeconds ?? 0)
  }

  const statusRemainingDailySeconds =
    typeof statusData?.remaining_daily_seconds === 'number' ? statusData.remaining_daily_seconds : null
  const remainingDailySeconds =
    isRunning && statusRemainingDailySeconds != null
      ? Math.max(statusRemainingDailySeconds - statusAgeSeconds, 0)
      : statusRemainingDailySeconds

  const quotaReached =
    typeof statusData?.quota_limit_reached === 'boolean'
      ? statusData.quota_limit_reached
      : remainingDailySeconds != null
        ? remainingDailySeconds <= 0
        : false

  const runtimeRestart = statusData?.runtime_restart ?? stream.runtime_restart
  const effectiveErrorMessage = statusData?.error_message ?? stream.error_message ?? null
  const providerHealthAttention = hasProviderHealthAttention({
    provider_health_status: statusData?.provider_health_status ?? stream.provider_health_status,
    provider_health_issues: statusData?.provider_health_issues ?? stream.provider_health_issues,
  })
  const requiresAttention =
    derivedStatus === 'error' ||
    runtimeRestart.state === 'retrying' ||
    runtimeRestart.state === 'scheduled' ||
    runtimeRestart.state === 'exhausted' ||
    quotaReached ||
    providerHealthAttention

  const group = isTransitioning
    ? 'transitioning'
    : isRunning
      ? 'live'
      : requiresAttention
        ? 'attention'
        : derivedStatus === 'scheduled'
          ? 'scheduled'
          : 'stopped'

  const primaryAction = isTransitioning
    ? 'pending'
    : isRunning
      ? 'stop'
      : derivedStatus === 'scheduled'
        ? 'edit_schedule'
        : requiresAttention
          ? 'view_issue'
          : 'start'

  return {
    derivedStatus,
    isRunning,
    isStarting,
    isStopping,
    isTransitioning,
    statusUnavailable: Boolean(statusQuery?.isError),
    statusFetching: Boolean(statusQuery?.isFetching && !statusData),
    liveDurationSeconds,
    totalDurationSeconds,
    remainingDailySeconds,
    quotaReached,
    runtimeRestart,
    effectiveErrorMessage,
    group,
    primaryAction,
    requiresAttention,
  }
}

export type DashboardNextAction = {
  key: 'upload' | 'connect' | 'create' | 'resume' | 'live' | 'attention'
  href: string
}

export function deriveDashboardNextAction({
  assetCount,
  destinationCount,
  streams,
  liveStatusMap,
  nowMs = Date.now(),
}: {
  assetCount: number
  destinationCount: number
  streams: Stream[]
  liveStatusMap?: Map<string, StreamStatusQuery>
  nowMs?: number
}): DashboardNextAction {
  if (assetCount <= 0) {
    return { key: 'upload', href: '/dashboard/library?tab=assets' }
  }

  if (destinationCount <= 0) {
    return { key: 'connect', href: '/dashboard/streaming' }
  }

  if (streams.length === 0) {
    return { key: 'create', href: '/dashboard/streaming' }
  }

  const derivedStreams = streams.map((stream) =>
    deriveStreamState(stream, liveStatusMap?.get(stream.id), nowMs),
  )

  if (derivedStreams.some((stream) => stream.requiresAttention)) {
    return { key: 'attention', href: '/dashboard/streaming' }
  }

  if (derivedStreams.some((stream) => stream.isRunning)) {
    return { key: 'live', href: '/dashboard/streaming' }
  }

  return { key: 'resume', href: '/dashboard/streaming' }
}
