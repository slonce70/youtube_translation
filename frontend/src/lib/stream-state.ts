import type { UseQueryResult } from '@tanstack/react-query'

import type {
  StreamIncidentCode,
  StreamIncidentItem,
  StreamIncidentSummary,
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
  isDegraded: boolean
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
  incidentSummary: StreamIncidentSummary
}

export type StreamIncidentNotice = {
  tone: 'degraded' | 'critical'
  title: string
  details: string[]
}

type StreamLogIncidentOptions = {
  nowMs?: number
  recencyWindowMs?: number
}

const DEFAULT_STREAM_LOG_RECENCY_WINDOW_MS = 15 * 60 * 1000
const LOG_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\b/

function createIncidentItem(
  code: StreamIncidentCode,
  severity: StreamIncidentItem['severity'],
  label: string,
  options: Pick<StreamIncidentItem, 'detail' | 'count' | 'lastMatchedLine'> = {},
): StreamIncidentItem {
  return {
    code,
    severity,
    label,
    ...options,
  }
}

function createIncidentSummary(items: StreamIncidentItem[]): StreamIncidentSummary {
  if (!items.length) {
    return {
      severity: 'healthy',
      headline: null,
      details: [],
      items: [],
    }
  }

  const severity = items.some((item) => item.severity === 'critical') ? 'critical' : 'degraded'
  const [primary, ...rest] = items

  return {
    severity,
    headline: primary.label,
    details: [primary.detail, ...rest.map((item) => item.label)].filter(
      (value): value is string => Boolean(value && value.trim()),
    ),
    items,
  }
}

function mergeIncidentSummaries(
  ...summaries: Array<StreamIncidentSummary | null | undefined>
): StreamIncidentSummary {
  const items: StreamIncidentItem[] = []
  const seen = new Set<string>()

  for (const summary of summaries) {
    if (!summary || !summary.items?.length) continue

    for (const item of summary.items) {
      const key = `${item.code}:${item.label}:${item.detail ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }

  return createIncidentSummary(items)
}

export function summarizeRuntimeIncidentState({
  isRunning,
  derivedStatus,
  quotaReached,
  runtimeRestart,
  providerHealthAttention,
  providerHealthIssues,
  effectiveErrorMessage,
}: {
  isRunning: boolean
  derivedStatus: StreamStatusValue
  quotaReached: boolean
  runtimeRestart: StreamRuntimeRestartInfo
  providerHealthAttention: boolean
  providerHealthIssues?: string[] | null
  effectiveErrorMessage?: string | null
}): StreamIncidentSummary {
  const items: StreamIncidentItem[] = []

  if (derivedStatus === 'error') {
    items.push(
      createIncidentItem(
        'stream_error',
        'critical',
        'Трансляція завершилась з помилкою',
        {
          detail: effectiveErrorMessage?.trim() || 'Потрібна перевірка логу та runtime state.',
        },
      ),
    )
  }

  if (quotaReached) {
    items.push(
      createIncidentItem(
        'quota_limit',
        isRunning ? 'critical' : 'degraded',
        'Вичерпано денний ліміт трансляції',
        {
          detail: isRunning
            ? 'Поточний ефір під ризиком примусової зупинки або деградації.'
            : 'Перед наступним запуском потрібно перевірити ліміти тарифу.',
        },
      ),
    )
  }

  if (runtimeRestart.state === 'retrying' || runtimeRestart.state === 'scheduled') {
    items.push(
      createIncidentItem(
        'runtime_restart',
        isRunning ? 'degraded' : 'critical',
        runtimeRestart.state === 'retrying'
          ? 'Runtime виконує повторний recovery'
          : 'Runtime запланував повторний restart',
        {
          detail: `Спроба ${runtimeRestart.attempts} з ${runtimeRestart.max_attempts}.`,
        },
      ),
    )
  }

  if (runtimeRestart.state === 'exhausted') {
    items.push(
      createIncidentItem(
        'runtime_restart',
        'critical',
        'Вичерпано бюджет автоматичних рестартів',
        {
          detail: `Використано ${runtimeRestart.attempts} з ${runtimeRestart.max_attempts} спроб.`,
        },
      ),
    )
  }

  if (providerHealthAttention) {
    const issuesCount = providerHealthIssues?.length ?? 0
    items.push(
      createIncidentItem(
        'provider_health',
        isRunning ? 'degraded' : 'critical',
        'Провайдер повідомляє про деградацію потоку',
        {
          detail:
            issuesCount > 0
              ? `Отримано ${issuesCount} сигнал(и) деградації від destination/provider health.`
              : 'Є ознаки проблем з ingest або здоровʼям каналу.',
        },
      ),
    )
  }

  return createIncidentSummary(items)
}

function collectLogPatternMatches(lines: string[], pattern: RegExp) {
  const matches = lines.filter((line) => pattern.test(line))
  return {
    count: matches.length,
    lastMatchedLine: matches.length ? matches[matches.length - 1] : null,
  }
}

function parseLogTimestampMs(line: string): number | null {
  const match = line.trim().match(LOG_TIMESTAMP_PATTERN)
  if (!match) return null
  const parsed = Date.parse(match[1])
  return Number.isNaN(parsed) ? null : parsed
}

function filterRecentStreamLogLines(
  lines: string[],
  {
    nowMs = Date.now(),
    recencyWindowMs = DEFAULT_STREAM_LOG_RECENCY_WINDOW_MS,
  }: StreamLogIncidentOptions = {},
): string[] {
  if (recencyWindowMs <= 0) {
    return lines.filter(Boolean)
  }

  const cutoff = nowMs - recencyWindowMs
  return lines.filter((rawLine) => {
    const line = rawLine?.trim()
    if (!line) return false
    const timestampMs = parseLogTimestampMs(line)
    return timestampMs == null || timestampMs >= cutoff
  })
}

export function summarizeStreamLogIncidents(
  lines: string[],
  options: StreamLogIncidentOptions = {},
): StreamIncidentSummary {
  const normalizedLines = filterRecentStreamLogLines(lines, options)
  const connectionReset = collectLogPatternMatches(normalizedLines, /Connection reset by peer/i)
  const brokenPipe = collectLogPatternMatches(normalizedLines, /Broken pipe/i)
  const recovery = collectLogPatternMatches(normalizedLines, /Recovery successful/i)
  const timelineDrift = collectLogPatternMatches(normalizedLines, /Non-monotonic DTS/i)
  const transportFaultCount = connectionReset.count + brokenPipe.count
  const items: StreamIncidentItem[] = []

  if (connectionReset.count > 0) {
    items.push(
      createIncidentItem(
        'transport_connection_reset',
        recovery.count > 0 ? 'degraded' : 'critical',
        `RTMPS ingest скинув з'єднання ${connectionReset.count} раз(и)`,
        {
          count: connectionReset.count,
          lastMatchedLine: connectionReset.lastMatchedLine,
        },
      ),
    )
  }

  if (brokenPipe.count > 0) {
    items.push(
      createIncidentItem(
        'transport_broken_pipe',
        recovery.count > 0 ? 'degraded' : 'critical',
        `FFmpeg зафіксував Broken pipe ${brokenPipe.count} раз(и)`,
        {
          count: brokenPipe.count,
          lastMatchedLine: brokenPipe.lastMatchedLine,
        },
      ),
    )
  }

  if (recovery.count > 0) {
    items.push(
      createIncidentItem(
        'transport_recovery',
        transportFaultCount > 0 ? 'degraded' : 'critical',
        `Runtime відновив потік ${recovery.count} раз(и)`,
        {
          detail:
            transportFaultCount > 0
              ? 'Потік живий, але вже проходив через transport fault і recovery.'
              : 'Лог показує recovery без повного контексту причини; варто перевірити raw log.',
          count: recovery.count,
          lastMatchedLine: recovery.lastMatchedLine,
        },
      ),
    )
  }

  if (timelineDrift.count > 0) {
    items.push(
      createIncidentItem(
        'timeline_drift',
        'degraded',
        `FFmpeg попереджає про Non-monotonic DTS ${timelineDrift.count} раз(и)`,
        {
          detail: 'Є ризик таймінгових артефактів або нестабільного muxing path.',
          count: timelineDrift.count,
          lastMatchedLine: timelineDrift.lastMatchedLine,
        },
      ),
    )
  }

  return createIncidentSummary(items)
}

export function buildStreamIncidentNotice(summary?: StreamIncidentSummary | null): StreamIncidentNotice | null {
  if (!summary || summary.severity === 'healthy' || !summary.headline) {
    return null
  }

  return {
    tone: summary.severity === 'critical' ? 'critical' : 'degraded',
    title: summary.headline,
    details: summary.details.slice(0, 3),
  }
}

export function getStreamLogLineClassName(line: string): string {
  if (/\[audit\]/i.test(line)) return 'text-amber-200'
  if (/Recovery successful/i.test(line)) return 'text-amber-200'
  if (/error|failed|forbidden|invalid|denied|fatal|Broken pipe|Connection reset by peer/i.test(line)) {
    return 'text-error-300'
  }
  if (/Non-monotonic DTS/i.test(line)) return 'text-amber-100'
  return 'text-slate-300'
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
  const runtimeIncidentSummary =
    statusData?.runtime_incident_summary ?? stream.runtime_incident_summary ?? null
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
    providerHealthAttention ||
    runtimeIncidentSummary?.severity === 'degraded' ||
    runtimeIncidentSummary?.severity === 'critical'
  const incidentSummary = mergeIncidentSummaries(
    summarizeRuntimeIncidentState({
      isRunning,
      derivedStatus,
      quotaReached,
      runtimeRestart,
      providerHealthAttention,
      providerHealthIssues: statusData?.provider_health_issues ?? stream.provider_health_issues,
      effectiveErrorMessage,
    }),
    runtimeIncidentSummary,
  )
  const isDegraded = isRunning && incidentSummary.severity !== 'healthy'

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
    isDegraded,
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
    incidentSummary,
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
