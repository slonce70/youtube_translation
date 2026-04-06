'use client'

import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  FileText,
  Loader2,
  Pencil,
  Play,
  Plus,
  Radio,
  Square,
  Trash2,
} from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocale, type TranslationValues } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { DropdownMenu, DropdownItem } from '@/components/ui/DropdownMenu'
import { LoadingState } from '@/components/LoadingState'
import { formatRelativeDateTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { deriveStreamState } from '@/lib/stream-state'
import type {
  MediaCollection,
  Playlist,
  Stream,
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
  videoCollectionMap: Map<string, MediaCollection>
  audioCollectionMap: Map<string, MediaCollection>
  t: Translator
  streamingStatus: Translator
  pendingStartStreamId?: string | null
  pendingStopStreamId?: string | null
  pendingDeleteStreamId?: string | null
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

type PresentedStream = {
  stream: Stream
  derived: ReturnType<typeof deriveStreamState>
}

const GROUP_ORDER: Array<PresentedStream['derived']['group']> = ['live', 'transitioning', 'attention', 'scheduled', 'stopped']

const STREAM_AVATAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-orange-500',
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function getStreamColor(name: string): string {
  return STREAM_AVATAR_COLORS[hashString(name) % STREAM_AVATAR_COLORS.length]
}

function getStreamInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase()
}

function getStatusBorderClass(group: string): string {
  switch (group) {
    case 'live': return 'border-l-4 border-l-success-500'
    case 'attention': return 'border-l-4 border-l-amber-500'
    case 'scheduled': return 'border-l-4 border-l-primary-400'
    default: return 'border-l-4 border-l-slate-300 dark:border-l-slate-600'
  }
}

function hasRetryHistory(runtimeRestart: Stream['runtime_restart'] | null | undefined): boolean {
  if (!runtimeRestart?.enabled) return false
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
  videoCollectionMap,
  audioCollectionMap,
  t,
  streamingStatus,
  pendingStartStreamId,
  pendingStopStreamId,
  pendingDeleteStreamId,
}: StreamsListProps) {
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [deleteDialogStream, setDeleteDialogStream] = useState<Stream | null>(null)
  const locale = useLocale()

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!deleteDialogStream) return
    const streamStillVisible = (streams ?? []).some((stream) => stream.id === deleteDialogStream.id)
    if (!streamStillVisible) {
      setDeleteDialogStream(null)
    }
  }, [deleteDialogStream, streams])

  const groupedStreams = useMemo(() => {
    const groups: Record<PresentedStream['derived']['group'], PresentedStream[]> = {
      live: [],
      transitioning: [],
      attention: [],
      scheduled: [],
      stopped: [],
    }

    for (const stream of streams ?? []) {
      const derived = deriveStreamState(stream, liveStatusMap.get(stream.id), nowTick)
      groups[derived.group].push({ stream, derived })
    }

    return groups
  }, [liveStatusMap, nowTick, streams])

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
          <div className="space-y-6">
            {GROUP_ORDER.map((groupKey) => {
              const items = groupedStreams[groupKey]
              if (!items.length) return null

              return (
                <section key={groupKey} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t(`streams.sections.${groupKey}`)}
                    </h3>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{items.length}</span>
                  </div>

                  <div className="space-y-3">
                    {items.map(({ stream, derived }) => {
                      const destinationNames =
                        stream.destinations
                          ?.filter((destination) => destination.enabled)
                          .map((destination) => destination.name)
                          .filter(Boolean) ?? []
                      const destinationLabel =
                        destinationNames.length > 0 ? destinationNames.join(', ') : t('streams.destinations.none')
                      const scheduleLabel =
                        stream.scheduled_start_enabled && stream.scheduled_start_time
                          ? formatRelativeDateTime(stream.scheduled_start_time, locale, '—')
                          : null
                      const createdLabel = formatRelativeDateTime(stream.created_at, locale, '—')
                      const streamName = stream.name || t('streams.untitled')
                      const sourceName = (() => {
                        if (stream.playlist_id) {
                          return playlistMap.get(stream.playlist_id)?.name ?? t('streams.unknownPlaylist')
                        }

                        if (stream.video_collection_id) {
                          return (
                            videoCollectionMap.get(stream.video_collection_id)?.name ??
                            t('streams.sources.videoCollection')
                          )
                        }

                        if (stream.audio_collection_id && stream.mix_mode === 'audio_only') {
                          return (
                            audioCollectionMap.get(stream.audio_collection_id)?.name ??
                            t('streams.sources.audioCollection')
                          )
                        }

                        if ((stream.stream_assets?.length ?? 0) > 0) {
                          return t('streams.sources.customQueue', {
                            count: stream.stream_assets?.length ?? 0,
                          })
                        }

                        return t('streams.unknownPlaylist')
                      })()
                      const retryVisible = hasRetryHistory(derived.runtimeRestart)
                      const isStartPending = pendingStartStreamId === stream.id
                      const isStopPending = pendingStopStreamId === stream.id
                      const isDeletePending = pendingDeleteStreamId === stream.id
                      const isRowPending = isStartPending || isStopPending || isDeletePending
                      const totalDurationLabel =
                        derived.totalDurationSeconds && derived.totalDurationSeconds > 0
                          ? formatDuration(derived.totalDurationSeconds)
                          : stream.playlist_id || (stream.stream_assets?.length ?? 0) > 0
                            ? formatDuration(derived.totalDurationSeconds)
                            : '—'
                      const primaryButton = (() => {
                        if (derived.primaryAction === 'stop') {
                          return (
                            <Button
                              size="sm"
                              variant="secondary"
                              isLoading={isStopPending}
                              onClick={() => onStopStream(stream.id)}
                            >
                              <Square className="w-4 h-4 mr-2" />
                              {t('streams.buttons.stop')}
                            </Button>
                          )
                        }

                        if (derived.primaryAction === 'edit_schedule') {
                          return (
                            <Button size="sm" onClick={() => onEditSchedule(stream)} disabled={isRowPending}>
                              <Clock3 className="w-4 h-4 mr-2" />
                              {t('streams.buttons.schedule')}
                            </Button>
                          )
                        }

                        if (derived.primaryAction === 'view_issue') {
                          return (
                            <Button size="sm" onClick={() => onViewLogs(stream.id)} disabled={isRowPending}>
                              <AlertTriangle className="w-4 h-4 mr-2" />
                              {t('streams.buttons.reviewIssue')}
                            </Button>
                          )
                        }

                        if (derived.primaryAction === 'pending') {
                          return (
                            <Button size="sm" disabled>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              {streamingStatus(derived.derivedStatus)}
                            </Button>
                          )
                        }

                        return (
                          <Button
                            size="sm"
                            isLoading={isStartPending}
                            disabled={isRowPending && !isStartPending}
                            onClick={() => onStartStream(stream)}
                          >
                            <Play className="w-4 h-4 mr-2" />
                            {t('streams.buttons.start')}
                          </Button>
                        )
                      })()

                      return (
                        <motion.article
                          key={stream.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={cn(
                            'rounded-xl border p-4',
                            getStatusBorderClass(derived.group),
                            derived.group === 'attention'
                              ? 'bg-amber-50/40 dark:bg-amber-950/10'
                              : derived.group === 'live'
                                ? 'bg-success-50/40 dark:bg-success-950/10'
                                : '',
                          )}
                        >
                          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0 flex-1 space-y-3">
                              <div className="flex flex-wrap items-center gap-3">
                                {/* Stream avatar */}
                                <div className={cn(
                                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white',
                                  getStreamColor(streamName),
                                )}>
                                  {getStreamInitial(streamName)}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                                      {streamName}
                                    </h4>
                                    {renderStatusBadge(derived.derivedStatus)}
                                    {derived.statusUnavailable && (
                                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                        <AlertTriangle className="w-3 h-3" />
                                        {t('streams.statusCheck.unreachable')}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-slate-500 dark:text-slate-400">
                                    {destinationLabel}
                                    {derived.isRunning && (
                                      <span className="ml-2 text-success-600 dark:text-success-400 font-medium">
                                        {formatDuration(derived.liveDurationSeconds)}
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </div>

                              {derived.effectiveErrorMessage && (
                                <div className="flex items-start gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm text-amber-800 dark:bg-slate-900/60 dark:text-amber-200">
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                  <span>{derived.effectiveErrorMessage}</span>
                                </div>
                              )}

                              <details className="group rounded-lg border border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-900/40">
                                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  {t('streams.buttons.details')}
                                  <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180 dark:text-slate-400" />
                                </summary>
                                <div className="grid gap-3 border-t border-slate-200 px-3 py-3 text-sm dark:border-slate-800 md:grid-cols-2">
                                  <div>
                                    <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.source')}</p>
                                    <p className="font-medium text-slate-900 dark:text-white">{sourceName}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.totalDuration')}</p>
                                    <p className="font-medium text-slate-900 dark:text-white">{totalDurationLabel}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.quotaRemaining')}</p>
                                    <p className="font-medium text-slate-900 dark:text-white">
                                      {derived.quotaReached
                                        ? t('streams.quota.limitReached')
                                        : formatDuration(derived.remainingDailySeconds)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-slate-500 dark:text-slate-400">
                                      {scheduleLabel ? t('streams.labels.scheduledStart') : t('streams.labels.created')}
                                    </p>
                                    <p className="font-medium text-slate-900 dark:text-white">
                                      {scheduleLabel ?? createdLabel}
                                    </p>
                                  </div>
                                  {retryVisible && (
                                    <div>
                                      <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.autoRetry')}</p>
                                      <p className="font-medium text-slate-900 dark:text-white">
                                        {t('streams.retry.attempt', {
                                          current: derived.runtimeRestart.attempts,
                                          max: derived.runtimeRestart.max_attempts,
                                        })}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </details>
                            </div>

                            {/* Actions: primary button + overflow menu */}
                            <div className="flex items-center gap-2 xl:flex-col xl:items-end">
                              {primaryButton}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onOpenLiveEditor(stream)}
                                disabled={isRowPending}
                              >
                                <Pencil className="w-4 h-4 mr-2" />
                                {t('streams.liveEdit.button')}
                              </Button>
                              <DropdownMenu disabled={isRowPending}>
                                <DropdownItem onClick={() => onViewLogs(stream.id)} disabled={isRowPending}>
                                  <FileText className="h-4 w-4" />
                                  {t('streams.buttons.logs')}
                                </DropdownItem>
                                <DropdownItem onClick={() => onEditSchedule(stream)} disabled={isRowPending}>
                                  <Clock3 className="h-4 w-4" />
                                  {t('streams.buttons.schedule')}
                                </DropdownItem>
                                <DropdownItem onClick={() => onOpenLiveEditor(stream)} disabled={isRowPending}>
                                  <Pencil className="h-4 w-4" />
                                  {t('streams.liveEdit.button')}
                                </DropdownItem>
                                <DropdownItem
                                  variant="danger"
                                  onClick={() => setDeleteDialogStream(stream)}
                                  disabled={isRowPending}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {t('streams.buttons.delete')}
                                </DropdownItem>
                              </DropdownMenu>
                            </div>
                          </div>
                        </motion.article>
                      )
                    })}
                  </div>
                </section>
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

        {deleteDialogStream ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
            <Card role="dialog" aria-modal="true" className="w-full max-w-md">
              <CardHeader className="space-y-2">
                <CardTitle>{t('streams.deleteConfirm.title')}</CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('streams.deleteConfirm.description', {
                    name: deleteDialogStream.name || t('streams.untitled'),
                  })}
                </p>
              </CardHeader>
              <CardContent className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDeleteDialogStream(null)}
                  disabled={pendingDeleteStreamId === deleteDialogStream.id}
                >
                  {t('streams.deleteConfirm.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    onDeleteStream(deleteDialogStream.id)
                    setDeleteDialogStream(null)
                  }}
                >
                  {t('streams.deleteConfirm.confirm')}
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
