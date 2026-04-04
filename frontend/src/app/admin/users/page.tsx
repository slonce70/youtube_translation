'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Users, Search, Download, Ban, CheckCircle, TrendingUp } from 'lucide-react'
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
import type { SubscriptionTierKey } from '@/lib/types'

export default function UsersManagement() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTier, setFilterTier] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [suspendDialog, setSuspendDialog] = useState<{
    userId: string
    email: string
    reason: string
  } | null>(null)
  const [unsuspendDialog, setUnsuspendDialog] = useState<{
    userId: string
    email: string
  } | null>(null)
  const queryClient = useQueryClient()
  const t = useTranslations('admin.users')
  const locale = useLocale()
  const [tierSelections, setTierSelections] = useState<Record<string, SubscriptionTierKey>>({})
  const PAGE_SIZE = 50
  const [page, setPage] = useState(0)

  const dateLocales: Record<string, DateFnsLocale> = {
    en: enUS,
    ru,
    uk: ukLocale,
  }

  const dateLocale = dateLocales[locale] ?? enUS
  const tierOptions: SubscriptionTierKey[] = ['free', 'fhd_start', 'fhd_flow', 'fhd_boost', 'uhd_start', 'uhd_flow', 'uhd_boost']

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['admin-users', filterTier, filterStatus, page],
    queryFn: () => api.admin.users.list({
      tier: filterTier !== 'all' ? filterTier : undefined,
      is_suspended: filterStatus === 'suspended' ? true : filterStatus === 'active' ? false : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    refetchInterval: 10000,
  })

  const userItems = usersData?.items ?? []
  const usersSummary = usersData?.summary

  useEffect(() => {
    setPage(0)
  }, [filterTier, filterStatus])

  useEffect(() => {
    setPage(0)
  }, [searchQuery])


  const getSubscriptionStatusLabel = (status?: string | null) => {
    if (!status) return t('subscriptionStatus.unknown')
    try {
      return t(`subscriptionStatus.${status}`)
    } catch {
      return status
    }
  }

  const suspendMutation = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) => 
      api.admin.users.suspend(userId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success(t('toasts.suspendSuccess'))
    },
    onError: (error: any) => {
      toast.error(error?.message || t('toasts.suspendError'))
    },
  })

  const unsuspendMutation = useMutation({
    mutationFn: (userId: string) => api.admin.users.unsuspend(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success(t('toasts.unsuspendSuccess'))
    },
    onError: (error: any) => {
      toast.error(error?.message || t('toasts.unsuspendError'))
    },
  })

  const changeTierMutation = useMutation({
    mutationFn: ({ userId, newTier, reason }: { userId: string; newTier: SubscriptionTierKey; reason?: string }) =>
      api.admin.users.changeTier(userId, newTier, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success(t('toasts.tierChangeSuccess'))
    },
    onError: (error: any) => {
      toast.error(error?.message || t('toasts.tierChangeError'))
    },
  })

  const handleSuspend = (userId: string, email: string) => {
    setSuspendDialog({ userId, email, reason: '' })
  }

  const handleUnsuspend = (userId: string) => {
    const user = userItems.find((item) => item.user_id === userId)
    if (!user) {
      return
    }
    setUnsuspendDialog({ userId, email: user.email })
  }

  const handleSuspendReasonChange = (reason: string) => {
    setSuspendDialog((current) => (current ? { ...current, reason } : current))
  }

  const handleConfirmSuspend = () => {
    if (!suspendDialog) {
      return
    }

    const reason = suspendDialog.reason.trim()
    if (!reason) {
      toast.error(t('dialogs.reasonRequired'))
      return
    }

    suspendMutation.mutate(
      { userId: suspendDialog.userId, reason },
      {
        onSuccess: () => {
          setSuspendDialog(null)
        },
      }
    )
  }

  const handleConfirmUnsuspend = () => {
    if (!unsuspendDialog) {
      return
    }

    unsuspendMutation.mutate(unsuspendDialog.userId, {
      onSuccess: () => {
        setUnsuspendDialog(null)
      },
    })
  }

  const handleTierSelectionChange = (userId: string, value: SubscriptionTierKey) => {
    setTierSelections((prev) => ({ ...prev, [userId]: value }))
  }

  const handleApplyTier = (userId: string) => {
    const selectedTier = tierSelections[userId]
    const user = userItems.find((item) => item.user_id === userId)
    const currentTier = user?.subscription_tier ?? 'free'
    const newTier = selectedTier ?? currentTier

    if (!user || newTier === currentTier) {
      return
    }

    const reason = prompt(t('prompts.changeTierReason', { email: user.email })) || undefined
    changeTierMutation.mutate({ userId, newTier, reason })
  }

  const getTierBadgeColor = (tier: string) => {
    const palette: Record<SubscriptionTierKey, string> = {
      free: 'from-slate-500 to-slate-600',
      fhd_start: 'from-primary-500 to-purple-500',
      fhd_flow: 'from-primary-500 to-purple-600',
      fhd_boost: 'from-primary-600 to-fuchsia-600',
      uhd_start: 'from-amber-500 to-orange-500',
      uhd_flow: 'from-amber-600 to-orange-600',
      uhd_boost: 'from-amber-700 to-rose-600',
    }

    return palette[(tier as SubscriptionTierKey) ?? 'free'] ?? 'from-slate-500 to-slate-600'
  }

  const formatPlanDate = (value?: string | null) => {
    if (!value) {
      return null
    }

    try {
      return new Date(value).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return null
    }
  }

  const filteredUsers = userItems.filter((user) => {
    const matchesSearch = user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (user.full_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

  const handleExport = () => {
    if (typeof window === 'undefined' || filteredUsers.length === 0) {
      return
    }

    const escapeCsv = (value: string | number | null | undefined) => {
      const normalized = value == null ? '' : String(value)
      return `"${normalized.replace(/"/g, '""')}"`
    }

    const rows = [
      ['email', 'full_name', 'subscription_tier', 'subscription_status', 'is_suspended', 'storage_gb', 'stream_hours', 'created_at', 'last_login_at'],
      ...filteredUsers.map((user) => [
        user.email,
        user.full_name || '',
        user.subscription_tier,
        user.subscription_status || '',
        user.is_suspended ? 'true' : 'false',
        (user.current_storage_bytes / (1024 ** 3)).toFixed(2),
        user.total_stream_hours.toFixed(1),
        user.created_at,
        user.last_login_at || '',
      ]),
    ]

    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `admin-users-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  const totalFetched = filteredUsers.length
  const pageStart = totalFetched > 0 ? page * PAGE_SIZE + 1 : 0
  const pageEnd = totalFetched > 0 ? pageStart + totalFetched - 1 : 0
  const hasNextPage = userItems.length === PAGE_SIZE

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">{t('header.title')}</h2>
          <p className="text-slate-600 dark:text-slate-400">
            {t('header.description')}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="secondary" size="sm" onClick={handleExport} disabled={filteredUsers.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            {t('actions.export')}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold">{usersSummary?.total ?? userItems.length}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.total')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-success-600">
                {usersSummary?.active ?? userItems.filter((user) => !user.is_suspended).length}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.active')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-error-600">
                {usersSummary?.suspended ?? userItems.filter((user) => user.is_suspended).length}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.suspended')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-primary-600">
                {usersSummary?.paid ?? userItems.filter((user) => user.subscription_tier !== 'free').length}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.paid')}</p>
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

            {/* Tier Filter */}
            <select
              value={filterTier}
              onChange={(e) => setFilterTier(e.target.value)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">{t('filters.tier.all')}</option>
              {tierOptions.map((tier) => (
                <option key={tier} value={tier}>
                  {t(`filters.tier.${tier}` as any)}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">{t('filters.status.all')}</option>
              <option value="active">{t('filters.status.active')}</option>
              <option value="suspended">{t('filters.status.suspended')}</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>{t('list.title', { count: filteredUsers.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-slate-500">{t('list.loading')}</div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 mx-auto text-slate-400 mb-4" />
              <p className="text-slate-600 dark:text-slate-400">{t('list.empty')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredUsers.map((user, index) => {
                const selectedTier = tierSelections[user.user_id] ?? user.subscription_tier
                const planStarted = formatPlanDate(user.subscription_started_at)
                const planExpires = formatPlanDate(user.subscription_expires_at)

                return (
                  <motion.div
                    key={user.user_id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={cn(
                      'p-4 rounded-lg border transition-all',
                      user.is_suspended
                        ? 'border-error-200 dark:border-error-800 bg-error-50 dark:bg-error-900/10'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-3 mb-2">
                          <h3 className="font-semibold text-lg">{user.full_name || t('list.noName')}</h3>
                          <Badge
                            variant="secondary"
                            className={`bg-gradient-to-r ${getTierBadgeColor(user.subscription_tier)} text-white border-0 capitalize`}
                          >
                            {t(`tiers.${user.subscription_tier}`)}
                          </Badge>
                          {user.is_suspended && (
                            <Badge variant="error" className="flex items-center space-x-1">
                              <Ban className="w-3 h-3" />
                              <span>{t('list.badges.suspended')}</span>
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{user.email}</p>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mb-3">
                          <span>
                            {t('list.labels.planTier', {
                              tier: t(`tiers.${user.subscription_tier}` as any),
                            })}
                          </span>
                          {planStarted && (
                            <span>
                              • {t('list.labels.planStarted', { date: planStarted })}
                            </span>
                          )}
                          <span>
                            • {user.subscription_expires_at && planExpires
                              ? t('list.labels.planExpires', { date: planExpires })
                              : t('list.labels.planNoExpiry')}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-slate-500 dark:text-slate-400 mb-1">{t('list.fields.storageUsed')}</p>
                            <p className="font-medium">{t('list.values.storage', { value: (user.current_storage_bytes / (1024 ** 3)).toFixed(2) })}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 dark:text-slate-400 mb-1">{t('list.fields.streamHours')}</p>
                            <p className="font-medium">{t('list.values.streamHours', { value: user.total_stream_hours.toFixed(1) })}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 dark:text-slate-400 mb-1">{t('list.fields.status')}</p>
                            <p className="font-medium">
                              {getSubscriptionStatusLabel(user.subscription_status)}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <span>
                            {t('list.values.joined', {
                              time: formatDistanceToNow(new Date(user.created_at), {
                                addSuffix: true,
                                locale: dateLocale,
                              }),
                            })}
                          </span>
                          {user.last_login_at ? (
                            <span>
                              •{' '}
                              {t('list.values.lastLogin', {
                                time: formatDistanceToNow(new Date(user.last_login_at), {
                                  addSuffix: true,
                                  locale: dateLocale,
                                }),
                              })}
                            </span>
                          ) : (
                            <span>• {t('list.values.neverLoggedIn')}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col space-y-3 sm:min-w-[14rem]">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <select
                            className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
                            value={selectedTier}
                            onChange={(e) => handleTierSelectionChange(user.user_id, e.target.value as SubscriptionTierKey)}
                          >
                            {tierOptions.map((tier) => (
                              <option key={tier} value={tier}>
                                {t(`tiers.${tier}` as any)}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            variant="primary"
                            className="flex items-center justify-center gap-2"
                            onClick={() => handleApplyTier(user.user_id)}
                            disabled={
                              changeTierMutation.isPending || selectedTier === user.subscription_tier
                            }
                          >
                            <TrendingUp className="w-4 h-4" />
                            <span>{t('list.actions.applyTier')}</span>
                          </Button>
                        </div>

                        {user.is_suspended ? (
                          <Button
                            size="sm"
                            variant="success"
                            className="flex items-center justify-center gap-2"
                            onClick={() => handleUnsuspend(user.user_id)}
                            disabled={unsuspendMutation.isPending}
                          >
                            <CheckCircle className="w-4 h-4" />
                            <span>{t('list.actions.unsuspend')}</span>
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="flex items-center justify-center gap-2"
                            onClick={() => handleSuspend(user.user_id, user.email)}
                            disabled={suspendMutation.isPending}
                          >
                            <Ban className="w-4 h-4" />
                            <span>{t('list.actions.suspend')}</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )
              })}
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

      {suspendDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="suspend-user-dialog-title"
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="space-y-2">
              <h3 id="suspend-user-dialog-title" className="text-xl font-semibold text-slate-900 dark:text-white">
                {t('dialogs.suspendTitle')}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {t('dialogs.suspendDescription', { email: suspendDialog.email })}
              </p>
            </div>
            <div className="mt-4 space-y-2">
              <label htmlFor="suspend-reason" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('dialogs.reasonLabel')}
              </label>
              <textarea
                id="suspend-reason"
                value={suspendDialog.reason}
                onChange={(e) => handleSuspendReasonChange(e.target.value)}
                placeholder={t('dialogs.reasonPlaceholder')}
                className="min-h-28 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => setSuspendDialog(null)}
                disabled={suspendMutation.isPending}
              >
                {t('dialogs.cancel')}
              </Button>
              <Button
                variant="secondary"
                className="flex items-center justify-center gap-2"
                onClick={handleConfirmSuspend}
                disabled={suspendMutation.isPending}
              >
                <Ban className="h-4 w-4" />
                <span>{t('dialogs.confirmSuspend')}</span>
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {unsuspendDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsuspend-user-dialog-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="space-y-2">
              <h3 id="unsuspend-user-dialog-title" className="text-xl font-semibold text-slate-900 dark:text-white">
                {t('dialogs.unsuspendTitle')}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {t('dialogs.unsuspendDescription', { email: unsuspendDialog.email })}
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => setUnsuspendDialog(null)}
                disabled={unsuspendMutation.isPending}
              >
                {t('dialogs.cancel')}
              </Button>
              <Button
                variant="success"
                className="flex items-center justify-center gap-2"
                onClick={handleConfirmUnsuspend}
                disabled={unsuspendMutation.isPending}
              >
                <CheckCircle className="h-4 w-4" />
                <span>{t('dialogs.confirmUnsuspend')}</span>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
