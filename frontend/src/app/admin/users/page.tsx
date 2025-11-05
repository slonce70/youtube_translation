'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Users, Search, Filter, Ban, CheckCircle } from 'lucide-react'
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

export default function UsersManagement() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTier, setFilterTier] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const queryClient = useQueryClient()
  const t = useTranslations('admin.users')
  const locale = useLocale()

  const dateLocales: Record<string, DateFnsLocale> = {
    en: enUS,
    ru,
    uk: ukLocale,
  }

  const dateLocale = dateLocales[locale] ?? enUS

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['admin-users', filterTier, filterStatus],
    queryFn: () => api.admin.users.list({
      tier: filterTier !== 'all' ? filterTier : undefined,
      is_suspended: filterStatus === 'suspended' ? true : filterStatus === 'active' ? false : undefined,
    }),
    refetchInterval: 10000,
  })

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

  const handleSuspend = (userId: string, email: string) => {
    const reason = prompt(t('prompts.suspendReason', { email }))
    if (reason) {
      suspendMutation.mutate({ userId, reason })
    }
  }

  const handleUnsuspend = (userId: string) => {
    if (confirm(t('prompts.unsuspendConfirm'))) {
      unsuspendMutation.mutate(userId)
    }
  }

  const getTierBadgeColor = (tier: string) => {
    switch (tier) {
      case 'enterprise': return 'from-amber-500 to-orange-600'
      case 'business': return 'from-accent-500 to-cyan-600'
      case 'pro': return 'from-primary-500 to-purple-600'
      default: return 'from-slate-500 to-slate-600'
    }
  }

  const filteredUsers = (usersData || []).filter(user => {
    const matchesSearch = user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (user.full_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

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
          <Button variant="secondary" size="sm">
            <Filter className="w-4 h-4 mr-2" />
            {t('actions.export')}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold">{usersData?.length || 0}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.total')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-success-600">
                {usersData?.filter(u => !u.is_suspended).length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.active')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-error-600">
                {usersData?.filter(u => u.is_suspended).length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('stats.suspended')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-primary-600">
                {usersData?.filter(u => ['pro', 'business', 'enterprise'].includes(u.subscription_tier)).length || 0}
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
              <option value="free">{t('filters.tier.free')}</option>
              <option value="pro">{t('filters.tier.pro')}</option>
              <option value="business">{t('filters.tier.business')}</option>
              <option value="enterprise">{t('filters.tier.enterprise')}</option>
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
              {filteredUsers.map((user, index) => (
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
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
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

                      {/* Usage Stats */}
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

                      {/* Metadata */}
                      <div className="mt-3 flex items-center space-x-4 text-xs text-slate-500 dark:text-slate-400">
                        <span>
                          {t('list.values.joined', {
                            time: formatDistanceToNow(new Date(user.created_at), {
                              addSuffix: true,
                              locale: dateLocale,
                            }),
                          })}
                        </span>
                        {user.last_login_at ? (
                          <>
                            <span>•</span>
                            <span>
                              {t('list.values.lastLogin', {
                                time: formatDistanceToNow(new Date(user.last_login_at), {
                                  addSuffix: true,
                                  locale: dateLocale,
                                }),
                              })}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>•</span>
                            <span>{t('list.values.neverLoggedIn')}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col space-y-2 ml-4">
                      {user.is_suspended ? (
                        <Button 
                          size="sm" 
                          variant="success" 
                          className="flex items-center space-x-2"
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
                          className="flex items-center space-x-2"
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
