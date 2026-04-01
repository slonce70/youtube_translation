'use client'

import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Clock3,
  Loader2,
  Play,
  Plus,
  Radio,
  Square,
  Trash2,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { Locale as DateFnsLocale } from 'date-fns'
import type { UseQueryResult } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import type { TranslationValues } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState } from '@/components/LoadingState'
import type {
  Playlist,
  Stream,
  StreamRuntimeRestartInfo,
  StreamStatusResponse,
  StreamStatusValue,
} from '@/lib/types'

type Translator = (key: string, values?: TranslationValues) => string

export type StreamsListProps = {
  streams?: Stream[]
  isLoading: boolean
  liveStatusMap: Map<string, UseQueryResult<StreamStatusResponse>>
  onCreateStream: () => void
  onViewLogs: (streamId: string) => void
  onOpenLiveEditor: (stream: Stream) => void
  onEditSchedule: (stream: Stream) => void
  onStartStream: (stream: Stream) => void
  onStopStream: (streamId: string) => void
  onDeleteStream: (streamId: string) => void
  renderStatusBadge: (status: StreamStatusValue) => ReactNode
  playlistMap: Map<string, Playlist>
  t: Translator
  streamingStatus: Translator
  dateLocale: DateFnsLocale
  isStartPending: boolean
  isStopPending: boolean
  isDeletePending: boolean
}

function formatDuration(seconds?: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) {
    return '—'
  }

  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  const parts = [hours, minutes, secs].map((value) => value.toString().padStart(2, '0'))
  return parts.join(':')
}

function formatRelativeDate(
  value: string | null | undefined,
  locale: DateFnsLocale,
  fallback: string,
): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale,
  })
}

function hasRetryHistory(runtimeRestart?: StreamRuntimeRestartInfo | null): boolean {
  if (!runtimeRestart) return false
  return runtimeRestart.attempts > 0 || Boolean(runtimeRestart.last_restart_at || runtimeRestart.last_failure_at)
}

export function StreamsList({
  streams,
  isLoading,
  liveStatusMap,
  onCreateStream,
  onViewLogs,
  onOpenLiveEditor,
  onEditSchedule,
  onStartStream,
  onStopStream,
  onDeleteStream,
  renderStatusBadge,
  playlistMap,
  t,
  streamingStatus,
  dateLocale,
  isStartPending,
  isStopPending,
  isDeletePending,
}: StreamsListProps) {
  const [nowTick, setNowTick] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center space-x-2">
          <Radio className="w-5 h-5" />
          <CardTitle>{t('streams.title')}</CardTitle>
        </div>
        <Button className="flex items-center space-x-2" onClick={onCreateStream}>
          <Plus className="w-4 h-4" />
          <span>{t('streams.new')}</span>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingState text={t('fetching')} />
        ) : streams && streams.length > 0 ? (
          <div className="space-y-4">
            {streams.map((stream) => {
              const statusQuery = liveStatusMap.get(stream.id)
              const statusData = statusQuery?.data
              const derivedStatus = statusData?.status ?? stream.status
              const isRunning = statusData?.is_running ?? stream.status === 'running'
              const statusUpdatedAtMs = statusQuery?.dataUpdatedAt ?? 0
              const statusAgeSeconds =
                isRunning && statusUpdatedAtMs > 0
                  ? Math.max(Math.floor((nowTick - statusUpdatedAtMs) / 1000), 0)
                  : 0
              const startedAtMs = stream.started_at ? new Date(stream.started_at).getTime() : null
              const statusLiveSeconds =
                typeof statusData?.live_duration_seconds === 'number' ? statusData.live_duration_seconds : null
              const liveDurationSeconds = isRunning
                ? statusLiveSeconds != null
                  ? statusLiveSeconds + statusAgeSeconds
                  : startedAtMs != null
                    ? Math.max(Math.floor((nowTick - startedAtMs) / 1000), 0)
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
              const dailyLimitSeconds =
                typeof statusData?.daily_limit_seconds === 'number' ? statusData.daily_limit_seconds : null
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
              const remainingDisplaySeconds = remainingDailySeconds ?? dailyLimitSeconds ?? null
              const hasTotalDuration = totalDurationSeconds != null && totalDurationSeconds > 0
              const destinationNames =
                stream.destinations?.filter((destination) => destination.enabled).map((destination) => destination.name).filter(Boolean) ?? []
              const destinationLabel =
                destinationNames.length > 0 ? destinationNames.join(', ') : t('streams.destinations.none')
              const hasScheduledStart = Boolean(stream.scheduled_start_enabled && stream.scheduled_start_time)
              const scheduledStartDate = hasScheduledStart ? new Date(stream.scheduled_start_time as string) : null
              const runtimeRestart = statusData?.runtime_restart ?? stream.runtime_restart
              const effectiveErrorMessage = statusData?.error_message ?? stream.error_message
              const hasScheduledRetry = runtimeRestart?.state === 'scheduled' && Boolean(runtimeRestart.next_restart_at)
              const retryExhausted = runtimeRestart?.state === 'exhausted'
              const lastRetryVisible = runtimeRestart?.last_restart_at && hasRetryHistory(runtimeRestart)

              return (
                <motion.div
                  key={stream.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-lg p-4 border ${
                    derivedStatus === 'error'
                      ? 'border-error-200 dark:border-error-800 bg-error-50/40 dark:bg-error-900/10'
                      : isRunning
                        ? 'border-success-200 dark:border-success-800 bg-success-50/40 dark:bg-success-900/10'
                        : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-lg font-semibold">{stream.name || t('streams.untitled')}</h3>
                        {renderStatusBadge(derivedStatus)}
                        {statusQuery?.isError && (
                          <span className="inline-flex items-center space-x-1 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{t('streams.statusCheck.unreachable')}</span>
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.playlist')}</p>
                          <p className="font-medium">
                            {stream.playlist_id
                              ? playlistMap.get(stream.playlist_id)?.name ?? t('streams.unknownPlaylist')
                              : t('streams.unknownPlaylist')}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.destinations')}</p>
                          <p className="font-medium">{destinationLabel}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.status')}</p>
                          <p className="font-medium flex items-center gap-2">
                            {streamingStatus(derivedStatus)}
                            {statusQuery?.isFetching && !statusData ? (
                              <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                            ) : null}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.created')}</p>
                          <p className="font-medium">
                            {formatDistanceToNow(new Date(stream.created_at), {
                              addSuffix: true,
                              locale: dateLocale,
                            })}
                          </p>
                        </div>
                        {hasScheduledStart && scheduledStartDate && (
                          <div>
                            <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.scheduledStart')}</p>
                            <p className="font-medium">
                              {formatDistanceToNow(scheduledStartDate, {
                                addSuffix: true,
                                locale: dateLocale,
                              })}
                            </p>
                          </div>
                        )}
                        {runtimeRestart?.enabled && hasRetryHistory(runtimeRestart) && (
                          <div>
                            <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.autoRetry')}</p>
                            <p className="font-medium">
                              {t('streams.retry.attempt', {
                                current: runtimeRestart.attempts,
                                max: runtimeRestart.max_attempts,
                              })}
                            </p>
                          </div>
                        )}
                      </div>

                      {(isRunning && liveDurationSeconds != null) || hasTotalDuration || dailyLimitSeconds !== null ? (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mt-4">
                          {isRunning && liveDurationSeconds != null && (
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.liveDuration')}</p>
                              <p className="font-medium">{formatDuration(liveDurationSeconds)}</p>
                            </div>
                          )}
                          {hasTotalDuration && (
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.totalDuration')}</p>
                              <p className="font-medium">{formatDuration(totalDurationSeconds)}</p>
                            </div>
                          )}
                          {dailyLimitSeconds !== null && (
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.quotaRemaining')}</p>
                              <p
                                className={`font-medium flex items-center gap-2 ${
                                  quotaReached ? 'text-amber-600 dark:text-amber-400' : ''
                                }`}
                              >
                                {quotaReached && <AlertTriangle className="w-3 h-3" />}
                                {quotaReached
                                  ? t('streams.quota.limitReached')
                                  : formatDuration(remainingDisplaySeconds)}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {runtimeRestart?.enabled && (hasScheduledRetry || retryExhausted || lastRetryVisible) && (
                        <div
                          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                            retryExhausted
                              ? 'border-error-200 bg-error-50 text-error-700 dark:border-error-800 dark:bg-error-900/10 dark:text-error-300'
                              : hasScheduledRetry
                                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/10 dark:text-amber-300'
                                : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/10 dark:text-blue-300'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            {hasScheduledRetry && (
                              <>
                                <span className="font-medium">{t('streams.retry.scheduled')}</span>
                                <span>
                                  {t('streams.retry.nextRestart', {
                                    value: formatRelativeDate(runtimeRestart.next_restart_at, dateLocale, '—'),
                                  })}
                                </span>
                              </>
                            )}
                            {retryExhausted && (
                              <span className="font-medium">
                                {t('streams.retry.exhausted', { count: runtimeRestart.attempts })}
                              </span>
                            )}
                            {!hasScheduledRetry && !retryExhausted && lastRetryVisible && (
                              <>
                                <span className="font-medium">{t('streams.retry.lastRestartLabel')}</span>
                                <span>
                                  {t('streams.retry.lastRestart', {
                                    value: formatRelativeDate(runtimeRestart.last_restart_at, dateLocale, '—'),
                                  })}
                                </span>
                              </>
                            )}
                            {runtimeRestart.last_failure_at && (
                              <span className="opacity-80">
                                {t('streams.retry.lastFailure', {
                                  value: formatRelativeDate(runtimeRestart.last_failure_at, dateLocale, '—'),
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {effectiveErrorMessage && (
                        <p className="text-sm text-error-600 dark:text-error-400 flex items-center gap-2 mt-2">
                          <AlertTriangle className="w-4 h-4" />
                          {effectiveErrorMessage}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 ml-4">
                      <Button size="sm" variant="outline" onClick={() => onViewLogs(stream.id)}>
                        {t('streams.buttons.logs')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`stream-live-edit-${stream.id}`}
                        onClick={() => onOpenLiveEditor(stream)}
                      >
                        {t('streams.liveEdit.button')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onEditSchedule(stream)}>
                        <Clock3 className="w-4 h-4 mr-2" />
                        {t('streams.buttons.schedule')}
                      </Button>
                      {stream.status === 'running' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          isLoading={isStopPending}
                          onClick={() => onStopStream(stream.id)}
                        >
                          <Square className="w-4 h-4 mr-2" />
                          {t('streams.buttons.stop')}
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            isLoading={isStartPending}
                            onClick={() => onStartStream(stream)}
                          >
                            <Play className="w-4 h-4 mr-2" />
                            {t('streams.buttons.start')}
                          </Button>
                          {stream.status === 'scheduled' && stream.scheduled_start_enabled && (
                            <Button
                              size="sm"
                              variant="secondary"
                              isLoading={isStopPending}
                              onClick={() => onStopStream(stream.id)}
                            >
                              <Square className="w-4 h-4 mr-2" />
                              {t('streams.buttons.cancelSchedule')}
                            </Button>
                          )}
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        isLoading={isDeletePending}
                        onClick={() => onDeleteStream(stream.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <Radio className="w-16 h-16 mx-auto text-slate-400 mb-4" />
            <p className="text-slate-600 dark:text-slate-400 mb-4">{t('streams.empty.title')}</p>
            <p className="text-sm text-slate-500 dark:text-slate-500 mb-6">{t('streams.empty.description')}</p>
            <Button variant="primary" size="lg" onClick={onCreateStream}>
              <Plus className="w-5 h-5 mr-2" />
              {t('streams.empty.cta')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
