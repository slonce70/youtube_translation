'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { bytesToGigabytes, formatBytes } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { Badge } from './ui/Badge'
import { Progress } from './ui/Progress'
import { Button } from './ui/Button'
import { Sparkles } from 'lucide-react'

interface PlanLimitsCardProps {
  storageUsedBytes: number
  storageLimitBytes: number
  storageUsagePercent: number
  hoursUsed: number
  hoursLimit: number
  hoursUsagePercent: number
  activeStreams: number
  streamLimit: number
  assetsCount: number
}

export function PlanLimitsCard({
  storageUsedBytes,
  storageLimitBytes,
  storageUsagePercent,
  hoursUsed,
  hoursLimit,
  hoursUsagePercent,
  activeStreams,
  streamLimit,
  assetsCount,
}: PlanLimitsCardProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.planLimits')
  const timeFormat = useTranslations('dashboard.timeFormat')
  const storageRemainingBytes = Math.max(0, storageLimitBytes - storageUsedBytes)
  const storageLimitGb = bytesToGigabytes(storageLimitBytes)

  const formatHours = (hours: number) => {
    const wholeHours = Math.floor(hours)
    const minutes = Math.round((hours - wholeHours) * 60)

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
          <CardTitle>{t('title')}</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
        </div>
        <Badge>{t('badge')}</Badge>
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
              value: formatHours(Math.max(0, hoursLimit - hoursUsed)),
            })}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
          <div>
            <p className="text-xs uppercase text-slate-400 dark:text-slate-500 tracking-wide">{t('concurrent.label')}</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{activeStreams} / {streamLimit}</p>
          </div>
          <Badge variant={activeStreams >= streamLimit ? 'warning' : 'success'}>
            {activeStreams >= streamLimit ? t('concurrent.limitReached') : t('concurrent.available')}
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
                <Button size="sm" onClick={() => router.push('/dashboard/plans')}>
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
