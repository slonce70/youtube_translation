'use client'

import { motion } from 'framer-motion'
import {
  AlertTriangle,
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
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState } from '@/components/LoadingState'
import type { Playlist, Stream, StreamStatusResponse, StreamStatusValue } from '@/lib/types'

type Translator = (key: string, values?: Record<string, unknown>) => string

export type StreamsListProps = {
  streams?: Stream[]
  isLoading: boolean
  liveStatusMap: Map<string, UseQueryResult<StreamStatusResponse>>
  onCreateStream: () => void
  onViewLogs: (streamId: string) => void
  onOpenLiveEditor: (stream: Stream) => void
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

export function StreamsList({
  streams,
  isLoading,
  liveStatusMap,
  onCreateStream,
  onViewLogs,
  onOpenLiveEditor,
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
              const derivedStatus = statusQuery?.data?.status ?? stream.status

              return (
                <motion.div
                  key={stream.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg p-4"
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

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.playlist')}</p>
                          <p className="font-medium">
                            {stream.playlist_id
                              ? playlistMap.get(stream.playlist_id)?.name ?? t('streams.unknownPlaylist')
                              : t('streams.unknownPlaylist')}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t('streams.labels.status')}</p>
                          <p className="font-medium flex items-center gap-2">
                            {streamingStatus(derivedStatus)}
                            {statusQuery?.isFetching && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
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
                      </div>

                      {stream.error_message && (
                        <p className="text-sm text-error-600 dark:text-error-400 flex items-center gap-2 mt-2">
                          <AlertTriangle className="w-4 h-4" />
                          {stream.error_message}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 ml-4">
                      <Button size="sm" variant="outline" onClick={() => onViewLogs(stream.id)}>
                        {t('streams.buttons.logs')}
                      </Button>
                      {stream.status === 'running' && (
                        <Button size="sm" variant="outline" onClick={() => onOpenLiveEditor(stream)}>
                          {t('streams.liveEdit.button')}
                        </Button>
                      )}
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
                        <Button
                          size="sm"
                          isLoading={isStartPending}
                          onClick={() => onStartStream(stream)}
                        >
                          <Play className="w-4 h-4 mr-2" />
                          {t('streams.buttons.start')}
                        </Button>
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
