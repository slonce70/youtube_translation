'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Radio, Search, Square } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { enUS, ru, uk as ukLocale } from 'date-fns/locale'
import type { Locale as DateFnsLocale } from 'date-fns'
import { toast } from 'sonner'
import { useTranslations, useLocale } from 'next-intl'

export default function StreamsMonitoring() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25
  const queryClient = useQueryClient()
  const t = useTranslations('admin.streams')
  const locale = useLocale()

  const dateLocales: Record<string, DateFnsLocale> = {
    en: enUS,
    ru,
    uk: ukLocale,
  }

  const dateLocale = dateLocales[locale] ?? enUS

  const { data: streamsData, isLoading } = useQuery({
    queryKey: ['admin-streams', filterStatus, page],
    queryFn: () => api.admin.streams.listAll({
      status: filterStatus !== 'all' ? filterStatus : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    refetchInterval: 5000,
  })

  useEffect(() => {
    setPage(0)
  }, [filterStatus])

  useEffect(() => {
    setPage(0)
  }, [searchQuery])

  const forceStopMutation = useMutation({
    mutationFn: (streamId: string) => api.admin.streams.forceStop(streamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-streams'] })
      toast.success(t('toasts.forceStopSuccess'))
    },
    onError: (error: any) => {
      toast.error(error?.message || t('toasts.forceStopError'))
    },
  })

  const handleForceStop = (streamId: string, streamName: string) => {
    if (confirm(t('prompts.forceStop', { name: streamName }))) {
      forceStopMutation.mutate(streamId)
    }
  }

  const filteredStreams = (streamsData || []).filter(stream => {
    const matchesSearch = stream.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         stream.user_email.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })
  const totalFetched = filteredStreams.length
  const pageStart = totalFetched > 0 ? page * PAGE_SIZE + 1 : 0
  const pageEnd = totalFetched > 0 ? pageStart + totalFetched - 1 : 0
  const hasNextPage = (streamsData?.length ?? 0) === PAGE_SIZE

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'success'
      case 'error': return 'error'
      case 'stopped': return 'secondary'
      default: return 'secondary'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold gradient-text mb-2">{t('header.title')}</h2>
        <p className="text-slate-600 dark:text-slate-400">
          {t('header.description')}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold">{streamsData?.length || 0}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.total')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-success-600">
                {streamsData?.filter(s => s.status === 'running').length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.running')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-error-600">
                {streamsData?.filter(s => s.status === 'error').length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.errors')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-slate-600">
                {streamsData?.filter(s => s.status === 'stopped').length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.stopped')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder={t('filters.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">{t('filters.status.all')}</option>
              <option value="running">{t('filters.status.running')}</option>
              <option value="error">{t('filters.status.error')}</option>
              <option value="stopped">{t('filters.status.stopped')}</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Streams List */}
      <Card>
        <CardHeader>
          <CardTitle>{t('list.title', { count: filteredStreams.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-slate-500">{t('list.loading')}</div>
          ) : filteredStreams.length === 0 ? (
            <div className="text-center py-12">
              <Radio className="w-16 h-16 mx-auto text-slate-400 mb-4" />
              <p className="text-slate-600 dark:text-slate-400">{t('list.empty')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredStreams.map((stream, index) => (
                <motion.div
                  key={stream.stream_id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={cn(
                    'p-4 rounded-lg border transition-all',
                    stream.status === 'error'
                      ? 'border-error-200 dark:border-error-800 bg-error-50 dark:bg-error-900/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="font-semibold text-lg">{stream.name}</h3>
                        <Badge variant={getStatusColor(stream.status)} className="flex items-center space-x-1">
                          {stream.status === 'running' && (
                            <span className="w-2 h-2 rounded-full bg-success-500 animate-pulse" />
                          )}
                          <span className="capitalize">{t(`list.status.${stream.status}`)}</span>
                        </Badge>
                      </div>

                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        {t('list.fields.user')}: {stream.user_email}
                      </p>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t('list.fields.playlistId')}</p>
                          <p className="font-medium text-xs truncate">{stream.playlist_id}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t('list.fields.destinations')}</p>
                          <p className="font-medium">{t('list.values.destinations', { count: stream.destinations_count })}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t('list.fields.started')}</p>
                          <p className="font-medium text-xs">
                            {stream.started_at 
                              ? formatDistanceToNow(new Date(stream.started_at), { addSuffix: true, locale: dateLocale })
                              : t('list.values.notStarted')}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">{t('list.fields.created')}</p>
                          <p className="font-medium text-xs">
                            {formatDistanceToNow(new Date(stream.created_at), { addSuffix: true, locale: dateLocale })}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col space-y-2 ml-4">
                      {stream.status === 'running' && (
                        <Button 
                          size="sm" 
                          variant="error" 
                          className="flex items-center space-x-2"
                          onClick={() => handleForceStop(stream.stream_id, stream.name)}
                          disabled={forceStopMutation.isPending}
                        >
                          <Square className="w-4 h-4" />
                          <span>{t('buttons.forceStop')}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mt-6 gap-3">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {t('pagination.showing', { start: pageStart, end: pageEnd })}
            </div>
            <div className="flex items-center space-x-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((prev) => Math.max(prev - 1, 0))}
                disabled={page === 0}
              >
                {t('pagination.previous')}
              </Button>
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t('pagination.page', { page: page + 1 })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((prev) => prev + 1)}
                disabled={!hasNextPage}
              >
                {t('pagination.next')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
