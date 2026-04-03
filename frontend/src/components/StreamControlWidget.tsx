'use client'

import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Radio, Play, Square, Loader2, AlertTriangle, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'

import { api } from '@/lib/api'
import type { Stream, StreamStatusResponse } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useDashboardContext } from '@/app/dashboard/dashboard-context'
import { formatRelativeDateTime } from '@/lib/dates'
import { deriveStreamState, getStreamPriority } from '@/lib/stream-state'

interface StreamControlWidgetProps {
  streams?: Stream[]
  liveStatusMap?: Map<string, UseQueryResult<StreamStatusResponse>>
  loading?: boolean
}

const statusBadges: Record<string, 'secondary' | 'error'> = {
  running: 'secondary',
  stopped: 'secondary',
  starting: 'secondary',
  stopping: 'secondary',
  error: 'error',
}

export function StreamControlWidget({
  streams,
  liveStatusMap,
  loading,
  onRefresh,
}: StreamControlWidgetProps & { onRefresh?: () => void }) {
  const queryClient = useQueryClient()
  const { user } = useDashboardContext()
  const t = useTranslations('dashboard.streamControl')
  const locale = useLocale()

  const startMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.start(streamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['streams', user?.id] }),
  })

  const stopMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.stop(streamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['streams', user?.id] }),
  })

  const activeStreams = useMemo(
    () =>
      (streams ?? [])
        .map((stream) => ({
          stream,
          derived: deriveStreamState(stream, liveStatusMap?.get(stream.id)),
        }))
        .sort((a, b) => getStreamPriority(b.derived) - getStreamPriority(a.derived)),
    [liveStatusMap, streams]
  )
  const hasAttentionStreams = activeStreams.some(({ derived }) => derived.requiresAttention)

  const header = (
    <CardHeader className="flex flex-row items-center justify-between space-y-0">
      <div>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
      </div>
      <div className="flex items-center space-x-2">
        {onRefresh && (
          <Button variant="ghost" size="sm" onClick={onRefresh} title="Refresh status">
            <Loader2 className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        )}
        <Link
          href="/dashboard/streaming"
          className="inline-flex items-center text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
        >
          {t('manageAll')}
          <ArrowUpRight className="ml-1 h-4 w-4" />
        </Link>
      </div>
    </CardHeader>
  )

  return (
    <Card>
      {header}
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="h-14 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : activeStreams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="p-3 rounded-full bg-slate-100 dark:bg-slate-800 mb-3">
              <Radio className="h-6 w-6 text-slate-500" />
            </div>
            <p className="font-medium text-slate-700 dark:text-slate-200">{t('empty.title')}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('empty.description')}</p>
            <Link
              href="/dashboard/streaming"
              className="mt-4 inline-flex items-center text-sm font-semibold text-primary-600 dark:text-primary-400 hover:underline"
            >
              {t('empty.cta')}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {activeStreams.slice(0, 3).map(({ stream, derived }, index) => {
              const badgeVariant = statusBadges[derived.derivedStatus] ?? 'secondary'
              const statusLabel =
                derived.derivedStatus in statusBadges ? t(`status.${derived.derivedStatus}`) : derived.derivedStatus
              const isMutating =
                (startMutation.isPending && startMutation.variables === stream.id) ||
                (stopMutation.isPending && stopMutation.variables === stream.id)
              const anyPending = startMutation.isPending || stopMutation.isPending
              const relativeTime = stream.started_at
                ? formatRelativeDateTime(stream.started_at, locale)
                : null
              const startedLabel = derived.isRunning && relativeTime
                ? t('labels.liveSince', { time: relativeTime })
                : derived.requiresAttention
                  ? t('labels.attention')
                  : t('labels.idle')

              return (
                <motion.div
                  key={stream.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={cn(
                    'flex items-center justify-between rounded-xl border px-4 py-3 transition-colors',
                    'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40'
                  )}
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20">
                      <Radio className="h-5 w-5 text-primary-600 dark:text-primary-300" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-white">
                        {stream.name || t('labels.untitled')}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{startedLabel}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <Badge variant={badgeVariant}>{statusLabel}</Badge>
                    {derived.statusUnavailable && (
                      <span className="inline-flex items-center space-x-1 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>{t('labels.unavailable')}</span>
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant={derived.isRunning ? 'secondary' : 'primary'}
                      onClick={() => (derived.isRunning ? stopMutation.mutate(stream.id) : startMutation.mutate(stream.id))}
                      disabled={anyPending || derived.primaryAction === 'pending'}
                      className="flex items-center"
                    >
                      {isMutating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : derived.isRunning ? (
                        <>
                          <Square className="mr-2 h-3.5 w-3.5" />
                          {t('buttons.stop')}
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-3.5 w-3.5" />
                          {t('buttons.goLive')}
                        </>
                      )}
                    </Button>
                  </div>
                </motion.div>
              )
            })}

            {activeStreams.length > 3 && (
              <Link
                href="/dashboard/streaming"
                className="block text-center text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-primary-600"
              >
                {t('buttons.viewAll')}
              </Link>
            )}

            {hasAttentionStreams && (
              <div className="flex items-center space-x-2 rounded-lg bg-error-50 dark:bg-error-900/20 px-3 py-2 text-xs text-error-600 dark:text-error-400">
                <AlertTriangle className="h-4 w-4" />
                <span>{t('labels.attention')}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
