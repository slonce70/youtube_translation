'use client'

import { useTranslations } from 'next-intl'
import { bytesToGigabytes, formatBytes } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Badge } from './ui/Badge'
import { Progress } from './ui/Progress'
import { Button } from './ui/Button'
import { Sparkles } from 'lucide-react'
import type { PlanDetail } from '@/lib/plans'
import type { SubscriptionTierKey } from '@/lib/types'

interface PlanLimitsCardProps {
  planKey: SubscriptionTierKey
  plan: PlanDetail
  storageUsedBytes: number
  hoursUsed: number
  activeStreams: number
  assetsCount: number
  onUpgrade?: () => void
}

export function PlanLimitsCard({
  planKey,
  plan,
  storageUsedBytes,
  hoursUsed,
  activeStreams,
  assetsCount,
  onUpgrade,
}: PlanLimitsCardProps) {
  const t = useTranslations('dashboard.planLimits')
  const timeFormat = useTranslations('dashboard.timeFormat')
  const planNames = useTranslations('dashboard.quota.tiers')

  const planName = planNames(planKey)
  const storageLimitBytes = plan.storageGb * Math.pow(1024, 3)
  const storageLimitGb = bytesToGigabytes(storageLimitBytes)
  const storageRemainingBytes = Math.max(0, storageLimitBytes - storageUsedBytes)
  const storageUsagePercent = storageLimitBytes === 0 ? 0 : Math.min(100, (storageUsedBytes / storageLimitBytes) * 100)

  const hoursLimit = plan.dailyLimitHours ?? Infinity
  const hoursUsagePercent = Number.isFinite(hoursLimit) && hoursLimit > 0 ? Math.min(100, (hoursUsed / (hoursLimit as number)) * 100) : 0
  const hoursRemaining = Number.isFinite(hoursLimit) ? Math.max(0, (hoursLimit as number) - hoursUsed) : Infinity

  const streamLimit = plan.streams
  const isStreamLimitReached = activeStreams >= streamLimit

  const formatHours = (value: number) => {
    if (!Number.isFinite(value)) {
      return timeFormat('unlimited')
    }

    const wholeHours = Math.floor(value)
    const minutes = Math.round((value - wholeHours) * 60)

    if (wholeHours <= 0) {
      return timeFormat('minutes', { minutes })
    }

    return minutes > 0
      ? timeFormat('hoursAndMinutes', { hours: wholeHours, minutes })
      : timeFormat('hours', { hours: wholeHours })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>{t('title', { plan: planName })}</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
        </div>
        <Badge>{t('badge', { plan: planName })}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{t('storage.label')}</span>
            <span>
              {t('storage.summary', {
                used: formatBytes(storageUsedBytes),
                limit: `${storageLimitGb.toFixed(0)} GB`,
              })}
            </span>
          </div>
          <Progress value={storageUsagePercent} indicatorClassName={storageUsagePercent >= 90 ? 'bg-error-500' : undefined} className="mt-2" />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {t('storage.remaining', { value: formatBytes(storageRemainingBytes) })}
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {t('storage.assets', { count: assetsCount })}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{t('streaming.label')}</span>
            <span>
              {t('streaming.summary', {
                used: formatHours(hoursUsed),
                limit: formatHours(hoursLimit),
              })}
            </span>
          </div>
          <Progress value={hoursUsagePercent} indicatorClassName={hoursUsagePercent >= 90 ? 'bg-error-500' : undefined} className="mt-2" />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {t('streaming.remaining', {
              value: formatHours(hoursRemaining),
            })}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
          <div>
            <p className="text-xs uppercase text-slate-400 dark:text-slate-500 tracking-wide">{t('concurrent.label')}</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{activeStreams} / {streamLimit}</p>
          </div>
          <Badge variant={isStreamLimitReached ? 'warning' : 'success'}>
            {isStreamLimitReached ? t('concurrent.limitReached') : t('concurrent.available')}
          </Badge>
        </div>

        <div className="rounded-lg border border-primary-200 dark:border-primary-900/40 bg-primary-50/60 dark:bg-primary-900/10 p-4">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-lg bg-primary-500 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">{t('upgrade.title')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('upgrade.description')}</p>
              <div className="mt-3 flex flex-col space-y-2">
                <Button size="sm" onClick={() => onUpgrade?.()}>
                  {t('upgrade.button')}
                </Button>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">{t('upgrade.reset')}</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
