'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Shield, ClipboardList, Users, Radio, AlertTriangle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { enUS, ru, uk as ukLocale } from 'date-fns/locale'
import type { Locale as DateFnsLocale } from 'date-fns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge, type BadgeProps } from '@/components/ui/Badge'
import { Button, buttonVariants } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { useTranslations, useLocale } from 'next-intl'
import type { SubscriptionTierKey, AdminActionLog } from '@/lib/types'
import { cn } from '@/lib/utils'

const ACTION_FILTERS = ['all', 'suspend_user', 'unsuspend_user', 'change_tier', 'force_stop_stream', 'resolve_alert'] as const
type ActionFilterValue = (typeof ACTION_FILTERS)[number]

const SUPPORTED_ACTION_TYPES = new Set<string>(ACTION_FILTERS.slice(1) as string[])
const TIER_KEYS: SubscriptionTierKey[] = ['free', 'fhd_start', 'fhd_flow', 'fhd_boost', 'uhd_start', 'uhd_flow', 'uhd_boost']

const dateLocales: Record<string, DateFnsLocale> = {
  en: enUS,
  ru,
  uk: ukLocale,
}

const actionBadgeVariant: Record<string, BadgeProps['variant']> = {
  suspend_user: 'error',
  unsuspend_user: 'success',
  change_tier: 'info',
  force_stop_stream: 'warning',
  resolve_alert: 'secondary',
}

export default function AdminSettings() {
  const t = useTranslations('admin.settings')
  const tUsers = useTranslations('admin.users')
  const locale = useLocale()
  const [actionFilter, setActionFilter] = useState<ActionFilterValue>('all')

  const dateLocale = dateLocales[locale] ?? enUS

  const { data: adminAccess, isLoading: accessLoading } = useQuery({
    queryKey: ['admin-access'],
    queryFn: () => api.admin.access(),
    refetchInterval: 60000,
  })

  const { data: actionLog, isLoading: actionsLoading } = useQuery({
    queryKey: ['admin-actions', actionFilter],
    queryFn: () =>
      api.admin.actions.list({
        action_type: actionFilter !== 'all' ? actionFilter : undefined,
        limit: 50,
        offset: 0,
      }),
    refetchInterval: 15000,
  })

  const tierLabel = useMemo(() => formatTier(adminAccess?.subscription_tier, tUsers), [adminAccess?.subscription_tier, tUsers])
  const subscriptionStatusLabel = useMemo(() => formatSubscriptionStatus(adminAccess?.subscription_status, tUsers), [adminAccess?.subscription_status, tUsers])
  const actions: AdminActionLog[] = actionLog ?? []

  const formatActionType = (actionType: string) => {
    const key = SUPPORTED_ACTION_TYPES.has(actionType) ? actionType : 'default'
    try {
      return t(`actions.actionNames.${key}` as any)
    } catch {
      return actionType
    }
  }

  const filterOptions = ACTION_FILTERS.map((value) => ({
    value,
    label: t(`actions.filters.${value}` as any),
  }))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold gradient-text mb-2">{t('header.title')}</h2>
        <p className="text-slate-600 dark:text-slate-400">
          {t('header.description')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{t('profile.title')}</span>
              <Shield className="w-5 h-5 text-slate-400" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {accessLoading ? (
              <div className="text-sm text-slate-500">{t('profile.loading')}</div>
            ) : adminAccess ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs uppercase text-slate-500 tracking-wide">{t('profile.fields.email')}</p>
                  <p className="text-lg font-semibold">{adminAccess.email}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="info">{t('profile.badges.admin')}</Badge>
                  <Badge variant={adminAccess.is_suspended ? 'error' : 'success'}>
                    {adminAccess.is_suspended ? t('profile.fields.suspended') : t('profile.fields.active')}
                  </Badge>
                </div>
                <dl className="space-y-3">
                  <div className="flex items-center justify-between">
                    <dt className="text-sm text-slate-500">{t('profile.fields.tier')}</dt>
                    <dd className="text-sm font-medium">{tierLabel}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-sm text-slate-500">{t('profile.fields.status')}</dt>
                    <dd className="text-sm font-medium">{subscriptionStatusLabel}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-sm text-slate-500">{t('profile.fields.suspension')}</dt>
                    <dd className="text-sm font-medium">
                      {adminAccess.is_suspended ? t('profile.fields.suspended') : t('profile.fields.notSuspended')}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="text-sm text-error-600">{t('profile.empty')}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{t('shortcuts.title')}</span>
              <ClipboardList className="w-5 h-5 text-slate-400" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">{t('shortcuts.description')}</p>
            <div className="space-y-3">
              <Link
                href="/admin/users"
                className={cn(buttonVariants({ variant: 'secondary' }), 'w-full justify-center gap-2')}
              >
                <Users className="w-4 h-4" />
                {t('shortcuts.users')}
              </Link>
              <Link
                href="/admin/streams"
                className={cn(buttonVariants({ variant: 'secondary' }), 'w-full justify-center gap-2')}
              >
                <Radio className="w-4 h-4" />
                {t('shortcuts.streams')}
              </Link>
              <Link
                href="/admin/alerts"
                className={cn(buttonVariants({ variant: 'secondary' }), 'w-full justify-center gap-2')}
              >
                <AlertTriangle className="w-4 h-4" />
                {t('shortcuts.alerts')}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-xl font-semibold">{t('actions.title')}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  variant={actionFilter === option.value ? 'primary' : 'ghost'}
                  onClick={() => setActionFilter(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-sm text-slate-500">{t('actions.description')}</p>
        </CardHeader>
        <CardContent>
          {actionsLoading ? (
            <div className="text-center py-10 text-slate-500">{t('actions.list.loading')}</div>
          ) : actions.length === 0 ? (
            <div className="text-center py-10 text-slate-500">{t('actions.list.empty')}</div>
          ) : (
            <div className="space-y-4">
              {actions.map((action) => (
                <div key={action.id} className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="font-semibold">{formatActionType(action.action_type)}</p>
                      <p className="text-xs text-slate-500">
                        {t('actions.list.by', { admin: action.admin_email })} •{' '}
                        {formatDistanceToNow(new Date(action.created_at), { addSuffix: true, locale: dateLocale })}
                      </p>
                    </div>
                    <Badge variant={actionBadgeVariant[action.action_type] ?? 'secondary'} className="capitalize">
                      {action.action_type.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    <p>
                      {t('actions.list.target', {
                        target: action.target_user_email ?? t('actions.list.targetUnknown'),
                      })}
                    </p>
                    {action.reason && <p>{t('actions.list.reason', { reason: action.reason })}</p>}
                  </div>
                  {action.details && Object.keys(action.details).length > 0 ? (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        {t('actions.list.details')}
                      </p>
                      <pre className="mt-1 text-xs bg-slate-950/5 dark:bg-slate-900 rounded-lg p-3 overflow-x-auto">
                        {JSON.stringify(action.details, null, 2)}
                      </pre>
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-slate-500">{t('actions.list.noDetails')}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function formatTier(tier: string | null | undefined, tUsers: ReturnType<typeof useTranslations>): string {
  if (!tier) {
    return tUsers('tiers.free')
  }
  const normalized = tier.toLowerCase()
  if (TIER_KEYS.includes(normalized as SubscriptionTierKey)) {
    return tUsers(`tiers.${normalized}` as any)
  }
  return tier
}

function formatSubscriptionStatus(status: string | null | undefined, tUsers: ReturnType<typeof useTranslations>): string {
  if (!status) {
    return tUsers('subscriptionStatus.unknown')
  }
  try {
    return tUsers(`subscriptionStatus.${status}` as any)
  } catch {
    return status
  }
}
