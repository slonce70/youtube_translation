'use client'

import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Radio, Play, Square, Loader2, AlertTriangle, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import type { Stream } from '@/lib/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface StreamControlWidgetProps {
  streams?: Stream[]
  loading?: boolean
}

const statusStyles: Record<string, { label: string; badge: 'success' | 'info' | 'warning' | 'error' }> = {
  running: { label: 'Live', badge: 'success' },
  stopped: { label: 'Stopped', badge: 'info' },
  starting: { label: 'Starting', badge: 'warning' },
  stopping: { label: 'Stopping', badge: 'warning' },
  error: { label: 'Error', badge: 'error' },
}

export function StreamControlWidget({ streams, loading }: StreamControlWidgetProps) {
  const queryClient = useQueryClient()

  const startMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.start(streamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['streams'] }),
  })

  const stopMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.stop(streamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['streams'] }),
  })

  const activeStreams = useMemo(
    () => (streams ?? []).sort((a, b) => (b.status === 'running' ? 1 : 0) - (a.status === 'running' ? 1 : 0)),
    [streams]
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Live Stream Controls</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Monitor status and quickly toggle your stream
          </p>
        </div>
        <Link
          href="/dashboard/streaming"
          className="inline-flex items-center text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
        >
          Manage All
          <ArrowUpRight className="ml-1 h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="h-14 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : !activeStreams || activeStreams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="p-3 rounded-full bg-slate-100 dark:bg-slate-800 mb-3">
              <Radio className="h-6 w-6 text-slate-500" />
            </div>
            <p className="font-medium text-slate-700 dark:text-slate-200">No streams yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Create your first stream to control it directly from the dashboard.
            </p>
            <Link
              href="/dashboard/streaming"
              className="mt-4 inline-flex items-center text-sm font-semibold text-primary-600 dark:text-primary-400 hover:underline"
            >
              Set up stream
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {activeStreams.slice(0, 3).map((stream, index) => {
              const status = statusStyles[stream.status] ?? { label: stream.status, badge: 'info' }
              const isMutating =
                (startMutation.isPending && startMutation.variables === stream.id) ||
                (stopMutation.isPending && stopMutation.variables === stream.id)
              const anyPending = startMutation.isPending || stopMutation.isPending
              const isRunning = stream.status === 'running'
              const startedAt = stream.started_at ? new Date(stream.started_at) : null
              const startedLabel = startedAt
                ? `Live ${formatDistanceToNow(startedAt, { addSuffix: true })}`
                : 'Idle'

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
                        {stream.name || 'Untitled Stream'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{startedLabel}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <Badge variant={status.badge}>{status.label}</Badge>
                    <Button
                      size="sm"
                      variant={isRunning ? 'secondary' : 'default'}
                      onClick={() => (isRunning ? stopMutation.mutate(stream.id) : startMutation.mutate(stream.id))}
                      disabled={anyPending}
                      className="flex items-center"
                    >
                      {isMutating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : isRunning ? (
                        <>
                          <Square className="mr-2 h-3.5 w-3.5" />
                          Stop
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-3.5 w-3.5" />
                          Go Live
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
                View all streams
              </Link>
            )}

            {(activeStreams ?? []).some((stream) => stream.status === 'error') && (
              <div className="flex items-center space-x-2 rounded-lg bg-error-50 dark:bg-error-900/20 px-3 py-2 text-xs text-error-600 dark:text-error-400">
                <AlertTriangle className="h-4 w-4" />
                <span>Some streams require attention</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
