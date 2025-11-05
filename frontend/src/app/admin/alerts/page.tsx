'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Search, CheckCircle } from 'lucide-react'
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

export default function AlertsManagement() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSeverity, setFilterSeverity] = useState<string>('all')
  const [filterResolved, setFilterResolved] = useState<string>('all')
  const queryClient = useQueryClient()
  const t = useTranslations('admin.alerts')
  const locale = useLocale()

  const dateLocales: Record<string, DateFnsLocale> = {
    en: enUS,
    ru,
    uk: ukLocale,
  }

  const dateLocale = dateLocales[locale] ?? enUS

  const { data: alertsData, isLoading } = useQuery({
    queryKey: ['admin-alerts', filterSeverity, filterResolved],
    queryFn: () => api.admin.alerts.list({
      severity: filterSeverity !== 'all' ? filterSeverity : undefined,
      resolved: filterResolved === 'resolved' ? true : filterResolved === 'unresolved' ? false : undefined,
    }),
    refetchInterval: 10000,
  })

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

  const filteredAlerts = (alertsData || []).filter(alert => {
    const matchesSearch = alert.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         alert.user_email.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

  const getSeverityColor = (severity: string) => {
    return severity === 'critical' ? 'error' : 'warning'
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
              <p className="text-3xl font-bold">{alertsData?.length || 0}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.total')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-error-600">
                {alertsData?.filter(a => !a.resolved).length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.unresolved')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-error-600">
                {alertsData?.filter(a => a.severity === 'critical' && !a.resolved).length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.critical')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-success-600">
                {alertsData?.filter(a => a.resolved).length || 0}
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
                    'p-4 rounded-lg border transition-all',
                    alert.resolved
                      ? 'border-slate-200 dark:border-slate-700 opacity-75'
                      : alert.severity === 'critical'
                      ? 'border-error-200 dark:border-error-800 bg-error-50 dark:bg-error-900/10'
                      : 'border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-900/10'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <AlertTriangle className={cn(
                          'w-5 h-5',
                          alert.severity === 'critical' ? 'text-error-600' : 'text-warning-600'
                        )} />
                        <h3 className="font-semibold">{alert.message}</h3>
                        <Badge variant={getSeverityColor(alert.severity)} className="capitalize">
                          {t(`list.severity.${alert.severity}`)}
                        </Badge>
                        {alert.resolved && (
                          <Badge variant="success" className="flex items-center space-x-1">
                            <CheckCircle className="w-3 h-3" />
                            <span>{t('list.badges.resolved')}</span>
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex items-center space-x-4 text-slate-600 dark:text-slate-400">
                          <span><strong>{t('list.fields.type')}:</strong> {alert.alert_type.replace(/_/g, ' ')}</span>
                          <span>•</span>
                          <span><strong>{t('list.fields.user')}:</strong> {alert.user_email}</span>
                          <span>•</span>
                          <span><strong>{t('list.fields.created')}:</strong> {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: dateLocale })}</span>
                        </div>

                        {alert.resolved && alert.resolved_at && (
                          <div className="p-2 bg-success-100 dark:bg-success-900/20 rounded text-success-700 dark:text-success-400">
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
                    <div className="flex items-center space-x-2 ml-4">
                      {!alert.resolved ? (
                        <Button 
                          size="sm" 
                          variant="success" 
                          className="flex items-center space-x-2"
                          onClick={() => handleResolve(alert.alert_id, alert.message)}
                          disabled={resolveMutation.isPending}
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>{t('buttons.resolve')}</span>
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" disabled className="opacity-50">
                          <CheckCircle className="w-4 h-4" />
                          <span className="sr-only">{t('buttons.resolved')}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
