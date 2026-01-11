'use client'

import { useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { HardDrive, Clock3, Radio, Video, Lightbulb, ChevronDown } from 'lucide-react'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/utils'
import { StatCard } from '@/components/StatCard'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { SubscriptionBanner } from '@/components/SubscriptionBanner'
import { QuickActions } from '@/components/QuickActions'
import { StreamControlWidget } from '@/components/StreamControlWidget'
import { PlanLimitsCard } from '@/components/PlanLimitsCard'
import { BroadcasterLevel } from '@/components/Gamification/BroadcasterLevel'
import { Progress } from '@/components/ui/Progress'
import { useDashboardContext } from './dashboard-context'
import { useStreamSocket } from './streaming/hooks/useStreamSocket'
import type { MetricsResponse, Stream, Asset, SubscriptionTierKey } from '@/lib/types'

export default function DashboardPage() {
  const queryClient = useQueryClient()
  const { user, quota, quotaLoading, currentTier, planDetail } = useDashboardContext()
  const dashboard = useTranslations('dashboard')
  const isSocketConnected = useStreamSocket(user?.id)

  const formatHoursLabel = useCallback((hours: number) => {
    if (!Number.isFinite(hours)) {
      return dashboard('timeFormat.unlimited')
    }
    const wholeHours = Math.floor(hours)
    const minutes = Math.round((hours - wholeHours) * 60)

    if (wholeHours <= 0) {
      return dashboard('timeFormat.minutes', { minutes })
    }

    return minutes > 0
      ? dashboard('timeFormat.hoursAndMinutes', { hours: wholeHours, minutes })
      : dashboard('timeFormat.hours', { hours: wholeHours })
  }, [dashboard])

  const computeRefetchInterval = useCallback(() => {
    if (typeof document === 'undefined') {
      return false
    }
    // If socket is connected, we don't need aggressive polling
    if (isSocketConnected) {
      return false
    }
    return document.visibilityState === 'visible' ? 5000 : false
  }, [isSocketConnected])

  const { data: metrics, isLoading: metricsLoading } = useQuery<MetricsResponse>({
    queryKey: ['metrics', user?.id],
    queryFn: api.metrics.get,
    refetchInterval: computeRefetchInterval,
    refetchOnWindowFocus: true,
    enabled: !!user,
  })

  const { data: streams, isLoading: streamsLoading } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id],
    queryFn: api.streams.list,
    refetchInterval: computeRefetchInterval,
    refetchOnWindowFocus: true,
    enabled: !!user,
  })

  const { data: assets, isLoading: assetsLoading } = useQuery<Asset[]>({
    queryKey: ['assets', user?.id, 'dashboard'],
    queryFn: () => api.assets.list(),
    enabled: !!user,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
  const planKey = (currentTier ?? 'free') as SubscriptionTierKey
  const plan = planDetail
  const planStorageLimitBytes = plan.storageGb * Math.pow(1024, 3)
  const planDailyLimitHours = plan.dailyLimitHours ?? Infinity
  const planStreamLimit = plan.streams

  const usage = useMemo(() => {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const activeStreams = (streams ?? []).filter((stream) => stream.status === 'running')

    const activeSeconds = activeStreams.reduce((total, stream) => {
      if (!stream.started_at) return total
      const startedAt = new Date(stream.started_at)
      const effectiveStart = startedAt < startOfDay ? startOfDay : startedAt
      const diffSeconds = (now.getTime() - effectiveStart.getTime()) / 1000
      return diffSeconds > 0 ? total + diffSeconds : total
    }, 0)

    const hoursUsed = activeSeconds / 3600
    const hoursUsagePercent = Number.isFinite(planDailyLimitHours) && planDailyLimitHours > 0
      ? Math.min(100, (hoursUsed / (planDailyLimitHours as number)) * 100)
      : 0

    const storageUsedBytes = (assets ?? []).reduce((total, asset) => total + (asset.size_bytes ?? 0), 0)
    const storageUsagePercent = planStorageLimitBytes === 0
      ? 0
      : Math.min(100, (storageUsedBytes / planStorageLimitBytes) * 100)

    const streamUsagePercent = Math.min(
      100,
      (activeStreams.length / planStreamLimit) * 100
    )

    const totalLifetimeHours = (streams ?? []).reduce((total, stream) => {
      return total + ((stream.total_duration_seconds ?? 0) / 3600)
    }, 0)

    return {
      activeStreams,
      assetsCount: assets?.length ?? 0,
      hoursUsed,
      totalLifetimeHours,
      hoursRemaining: Number.isFinite(planDailyLimitHours)
        ? Math.max(0, (planDailyLimitHours as number) - hoursUsed)
        : Infinity,
      hoursUsagePercent: Number.isFinite(hoursUsagePercent) ? hoursUsagePercent : 0,
      storageUsedBytes,
      storageRemainingBytes: Math.max(0, planStorageLimitBytes - storageUsedBytes),
      storageUsagePercent: Number.isFinite(storageUsagePercent) ? storageUsagePercent : 0,
      streamUsagePercent: Number.isFinite(streamUsagePercent) ? streamUsagePercent : 0,
    }
  }, [assets, streams, planDailyLimitHours, planStorageLimitBytes, planStreamLimit])

  const statCards = useMemo(
    () => [
      {
        title: dashboard('stats.storageUsed'),
        value: `${formatBytes(usage.storageUsedBytes)} / ${plan.storageGb} GB`,
        icon: HardDrive,
        gradient: 'from-primary-500 to-cyan-500',
      },
      {
        title: dashboard('stats.streamingTimeLeft'),
        value: formatHoursLabel(usage.hoursRemaining),
        icon: Clock3,
        gradient: 'from-purple-500 to-pink-500',
      },
      {
        title: dashboard('stats.activeStreams'),
        value: `${usage.activeStreams.length} / ${planStreamLimit}`,
        icon: Radio,
        gradient: 'from-success-500 to-emerald-500',
      },
      {
        title: dashboard('stats.libraryAssets'),
        value: usage.assetsCount,
        icon: Video,
        gradient: 'from-amber-500 to-orange-500',
      },
    ],
    [dashboard, usage, formatHoursLabel, plan.storageGb, planStreamLimit]
  )

  const initialLoading =
    (!metrics && !streams && !assets && (metricsLoading || streamsLoading || assetsLoading)) ||
    (quotaLoading && !quota)

  if (initialLoading) {
    return <LoadingState />
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold gradient-text mb-2">{dashboard('title.heading')}</h2>
        <p className="text-slate-600 dark:text-slate-400">
          {dashboard('title.subheading')}
        </p>
      </div>

      <SubscriptionBanner
        tier={planKey}
        onUpgrade={() => window.location.assign('/dashboard/plans')}
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 items-stretch">
        {statCards.map((card, index) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            icon={card.icon}
            gradient={card.gradient}
            delay={index * 0.05}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{dashboard('usage.heading')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>{dashboard('usage.storageLabel')}</span>
                  <span>{dashboard('usage.storageUsed', { value: formatBytes(usage.storageUsedBytes) })}</span>
                </div>
                <Progress value={usage.storageUsagePercent} className="mt-2" indicatorClassName={usage.storageUsagePercent >= 90 ? 'bg-error-500' : undefined} />
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {dashboard('usage.storageRemaining', {
                    remaining: formatBytes(usage.storageRemainingBytes),
                    limit: `${plan.storageGb} GB`,
                  })}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>{dashboard('usage.dailyStreamingLabel')}</span>
                  <span>{dashboard('usage.dailyStreamingUsed', {
                    value: formatHoursLabel(usage.hoursUsed),
                  })}</span>
                </div>
                <Progress value={usage.hoursUsagePercent} className="mt-2" indicatorClassName={usage.hoursUsagePercent >= 90 ? 'bg-error-500' : undefined} />
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {dashboard('usage.dailyStreamingRemaining', {
                    remaining: formatHoursLabel(usage.hoursRemaining),
                    limit: formatHoursLabel(planDailyLimitHours),
                  })}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>{dashboard('usage.concurrentLabel')}</span>
                  <span>{dashboard('usage.concurrentValue', {
                    current: usage.activeStreams.length,
                    limit: planStreamLimit,
                  })}</span>
                </div>
                <Progress value={usage.streamUsagePercent} className="mt-2" indicatorClassName={usage.streamUsagePercent >= 90 ? 'bg-error-500' : undefined} />
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {dashboard('usage.concurrentHint')}
                </p>
              </div>
            </CardContent>
          </Card>

          <QuickActions />

          <StreamControlWidget
            streams={streams}
            loading={streamsLoading}
            onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: ['streams'] })
              queryClient.invalidateQueries({ queryKey: ['metrics'] })
            }}
          />
        </div>

        <div className="space-y-6">
          <BroadcasterLevel 
            totalStreamHours={usage.totalLifetimeHours + usage.hoursUsed} 
            totalAssets={usage.assetsCount} 
          />

          <PlanLimitsCard
            planKey={planKey}
            plan={plan}
            storageUsedBytes={usage.storageUsedBytes}
            hoursUsed={usage.hoursUsed}
            activeStreams={usage.activeStreams.length}
            assetsCount={usage.assetsCount}
            onUpgrade={() => window.location.assign('/dashboard/plans')}
          />

          <Card>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4">
                <span className="text-base font-semibold text-slate-900 dark:text-white">
                  {dashboard('checklist.heading')}
                </span>
                <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180 dark:text-slate-400" />
              </summary>
              <div className="space-y-4 px-6 pb-6 text-sm text-slate-600 dark:text-slate-400">
                <div className="flex items-start space-x-3">
                  <Lightbulb className="mt-0.5 h-4 w-4 text-primary-500" />
                  <div>
                    <p className="font-medium text-slate-700 dark:text-slate-200">
                      {dashboard('checklist.items.warmup.title')}
                    </p>
                    <p>{dashboard('checklist.items.warmup.description')}</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <Lightbulb className="mt-0.5 h-4 w-4 text-primary-500" />
                  <div>
                    <p className="font-medium text-slate-700 dark:text-slate-200">
                      {dashboard('checklist.items.rotate.title')}
                    </p>
                    <p>{dashboard('checklist.items.rotate.description')}</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <Lightbulb className="mt-0.5 h-4 w-4 text-primary-500" />
                  <div>
                    <p className="font-medium text-slate-700 dark:text-slate-200">
                      {dashboard('checklist.items.upgrade.title')}
                    </p>
                    <p>{dashboard('checklist.items.upgrade.description')}</p>
                  </div>
                </div>
              </div>
            </details>
          </Card>
        </div>
      </div>
    </div>
  )
}
