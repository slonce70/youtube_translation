'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Search, CheckCircle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { QueryStateCard } from '@/components/ui/QueryStateCard'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { enUS, ru, uk as ukLocale } from 'date-fns/locale'
import type { Locale as DateFnsLocale } from 'date-fns'
import { toast } from 'sonner'
import { useTranslations, useLocale } from 'next-intl'

export default function AlertsManagement() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [filterResolved, setFilterResolved] = useState<string>('all')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25
  const queryClient = useQueryClient()
  const t = useTranslations('admin.alerts')
  const tCommon = useTranslations('common.actions')
  const locale = useLocale()

  const dateLocales: Record<string, DateFnsLocale> = {
    en: enUS,
    ru,
    uk: ukLocale,
  }

  const dateLocale = dateLocales[locale] ?? enUS
  const getAlertUserLabel = (userEmail?: string | null) =>
    userEmail?.trim() || t('list.fields.unknownUser')

  const { data: alertsData, isLoading, isError, error } = useQuery({
    queryKey: ['admin-alerts', filterSeverity, filterResolved, page],
    queryFn: () => api.admin.alerts.list({
      severity: filterSeverity !== 'all' ? filterSeverity : undefined,
      resolved: filterResolved === 'resolved' ? true : filterResolved === 'unresolved' ? false : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    refetchInterval: 10000,
  })

  useEffect(() => {
    setPage(0)
  }, [filterSeverity, filterResolved])

  useEffect(() => {
    setPage(0)
  }, [searchQuery])

  const resolveMutation = useMutation({
    mutationFn: ({ alertId, notes }: { alertId: string; notes?: string }) => 
      api.admin.alerts.resolve(alertId, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-alerts'] })
      toast.success(t('toasts.resolveSuccess'))
    },
    onError: (error: any) => {
      toast.error(error?.message || t('toasts.resolveError'))
    },
  })

  const handleResolve = (alertId: string, message: string) => {
    const notes = prompt(t('prompts.resolve', { message }))
    if (notes !== null) {
      resolveMutation.mutate({ alertId, notes: notes || undefined })
    }
  }

  const alertItems = alertsData?.items ?? []

  const filteredAlerts = alertItems.filter(alert => {
    const matchesSearch = alert.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         getAlertUserLabel(alert.user_email).toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })
  const totalFetched = filteredAlerts.length
  const pageStart = totalFetched > 0 ? page * PAGE_SIZE + 1 : 0
  const pageEnd = totalFetched > 0 ? pageStart + totalFetched - 1 : 0
  const hasNextPage = (alertItems.length ?? 0) === PAGE_SIZE

  const handleRetry = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-alerts'] })
  }

  const getSeverityColor = (severity: string) => {
    return severity === 'critical' ? 'error' : 'warning'
  }

  const getAlertTypeLabel = (alertType: string) => {
    try {
      return t(`list.alertTypes.${alertType}` as any)
    } catch {
      return alertType.replace(/_/g, ' ')
    }
  }

  const getAlertSurfaceClassName = (severity: string, resolved: boolean) => {
    if (resolved) {
      return 'border-slate-200/80 bg-slate-50/90 dark:border-slate-700/80 dark:bg-slate-900/50'
    }

    if (severity === 'critical') {
      return 'border-error-400/40 bg-slate-50/95 ring-1 ring-error-500/10 dark:border-error-500/30 dark:bg-slate-950/40 dark:ring-error-500/20'
    }

    return 'border-amber-400/50 bg-slate-50/95 ring-1 ring-amber-500/10 dark:border-amber-500/30 dark:bg-slate-950/40 dark:ring-amber-500/20'
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
              <p className="text-3xl font-bold">{isError ? '—' : alertsData?.summary.total ?? 0}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.total')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-error-600">
                {isError ? '—' : alertsData?.summary.unresolved ?? 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.unresolved')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-error-600">
                {isError ? '—' : alertsData?.summary.critical ?? 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.critical')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-success-600">
                {isError ? '—' : alertsData?.summary.resolved ?? 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.resolved')}</p>
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

            {/* Severity Filter */}
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">{t('filters.severity.all')}</option>
              <option value="critical">{t('filters.severity.critical')}</option>
              <option value="warning">{t('filters.severity.warning')}</option>
            </select>

            {/* Status Filter */}
            <select
              value={filterResolved}
              onChange={(e) => setFilterResolved(e.target.value)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">{t('filters.status.all')}</option>
              <option value="unresolved">{t('filters.status.unresolved')}</option>
              <option value="resolved">{t('filters.status.resolved')}</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Alerts List */}
      <Card>
        <CardHeader>
          <CardTitle>{t('list.title', { count: filteredAlerts.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-slate-500">{t('list.loading')}</div>
          ) : filteredAlerts.length === 0 ? (
            <div className="text-center py-12">
              <AlertTriangle className="w-16 h-16 mx-auto text-slate-400 mb-4" />
              <p className="text-slate-600 dark:text-slate-400">{t('list.empty')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAlerts.map((alert, index) => (
                <motion.div
                  key={alert.alert_id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={cn(
                    'rounded-2xl border p-5 transition-colors',
                    getAlertSurfaceClassName(alert.severity, alert.resolved),
                    alert.resolved && 'opacity-80'
                  )}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <AlertTriangle className={cn(
                          'h-5 w-5 shrink-0',
                          alert.severity === 'critical' ? 'text-error-600' : 'text-warning-600'
                        )} />
                        <h3 className="min-w-0 break-words text-base font-semibold text-slate-950 dark:text-slate-50">
                          {alert.message}
                        </h3>
                        <Badge variant={getSeverityColor(alert.severity)} className="capitalize">
                          {t(`list.severity.${alert.severity}`)}
                        </Badge>
                        {alert.resolved && (
                          <Badge variant="success" className="flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            <span>{t('list.badges.resolved')}</span>
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-3 text-sm">
                        <div
                          className={cn(
                            'flex flex-wrap items-start gap-x-4 gap-y-2',
                            alert.resolved
                              ? 'text-slate-600 dark:text-slate-300'
                              : 'text-slate-700 dark:text-slate-300'
                          )}
                        >
                          <span><strong>{t('list.fields.type')}:</strong> {alert.alert_type.replace(/_/g, ' ')}</span>
                          <span className="hidden text-slate-400 sm:inline">•</span>
                          <span className="break-all"><strong>{t('list.fields.user')}:</strong> {getAlertUserLabel(alert.user_email)}</span>
                          <span className="hidden text-slate-400 sm:inline">•</span>
                          <span><strong>{t('list.fields.created')}:</strong> {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: dateLocale })}</span>
                        </div>

                        {alert.resolved && alert.resolved_at && (
                          <div className="rounded-xl bg-success-100/90 p-3 text-success-700 dark:bg-success-900/20 dark:text-success-300">
                            <strong>{t('list.fields.resolved')}:</strong> {t('list.resolvedAgo', {
                              time: formatDistanceToNow(new Date(alert.resolved_at), {
                                addSuffix: true,
                                locale: dateLocale,
                              }),
                            })}
                            {alert.resolved_by && t('list.resolvedBy', { user: alert.resolved_by })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-2 self-start lg:ml-4">
                      {!alert.resolved ? (
                        <Button 
                          size="sm" 
                          variant="success" 
                          className="flex items-center gap-2 whitespace-nowrap hover:scale-100"
                          onClick={() => handleResolve(alert.alert_id, alert.message)}
                          disabled={resolveMutation.isPending}
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>{t('buttons.resolve')}</span>
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled
                          className="gap-2 border border-slate-200/80 bg-slate-100/80 opacity-70 dark:border-slate-700 dark:bg-slate-800/70"
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>{t('buttons.resolved')}</span>
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
