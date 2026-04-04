'use client'

import { useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Clock3, Radio, Lightbulb, ChevronDown, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/utils'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { SubscriptionBanner } from '@/components/SubscriptionBanner'
import { StreamControlWidget } from '@/components/StreamControlWidget'
import { PlanLimitsCard } from '@/components/PlanLimitsCard'
import { BroadcasterLevel } from '@/components/Gamification/BroadcasterLevel'
import { Progress } from '@/components/ui/Progress'
import { Button } from '@/components/ui/Button'
import { useDashboardContext } from './dashboard-context'
import { useStreamSocket } from './streaming/hooks/useStreamSocket'
import type { Stream, Asset, SubscriptionTierKey } from '@/lib/types'
import { useStreamStatusMap } from './streaming/hooks/useStreamStatusMap'
import { deriveDashboardNextAction, deriveStreamState, getStreamPriority } from '@/lib/stream-state'

export default function DashboardPage() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { user, quota, quotaLoading, currentTier, planDetail } = useDashboardContext()
  const dashboard = useTranslations('dashboard')
  useStreamSocket(user?.id)

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

  const { data: streams, isLoading: streamsLoading } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id],
    queryFn: api.streams.list,
    refetchInterval: typeof document !== 'undefined' && document.visibilityState === 'visible' ? 5000 : false,
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
  const liveStatusMap = useStreamStatusMap(streams, user?.id)
  const planKey = (currentTier ?? 'free') as SubscriptionTierKey
  const plan = planDetail
  const planStorageLimitBytes = plan.storageGb * Math.pow(1024, 3)
  const planDailyLimitHours = plan.dailyLimitHours ?? Infinity
  const planStreamLimit = plan.streams

  const presentedStreams = useMemo(
    () =>
      (streams ?? [])
        .map((stream) => ({
          stream,
          derived: deriveStreamState(stream, liveStatusMap.get(stream.id)),
        }))
        .sort((a, b) => getStreamPriority(b.derived) - getStreamPriority(a.derived)),
    [liveStatusMap, streams],
  )

  const usage = useMemo(() => {
    const activeStreams = presentedStreams.filter(({ derived }) => derived.isRunning).map(({ stream }) => stream)
    const storageUsedBytes =
      quota?.storage.used_bytes ?? (assets ?? []).reduce((total, asset) => total + (asset.size_bytes ?? 0), 0)
    const storageUsagePercent =
      quota?.storage.percent ??
      (planStorageLimitBytes === 0 ? 0 : Math.min(100, (storageUsedBytes / planStorageLimitBytes) * 100))
    const hoursUsed = quota?.streaming_hours.used ?? 0
    const hoursUsagePercent =
      quota?.streaming_hours.percent ??
      (Number.isFinite(planDailyLimitHours) && planDailyLimitHours > 0
        ? Math.min(100, (hoursUsed / (planDailyLimitHours as number)) * 100)
        : 0)
    const streamUsagePercent =
      quota?.streams.percent ?? Math.min(100, (activeStreams.length / planStreamLimit) * 100)

    const totalLifetimeHours = (streams ?? []).reduce((total, stream) => {
      return total + ((stream.total_duration_seconds ?? 0) / 3600)
    }, 0)

    const hoursLimit = quota?.streaming_hours.unlimited ? Infinity : (quota?.streaming_hours.limit ?? planDailyLimitHours)

    return {
      activeStreams,
      assetsCount: quota?.assets.count ?? assets?.length ?? 0,
      hoursUsed,
      totalLifetimeHours,
      hoursRemaining: Number.isFinite(hoursLimit)
        ? Math.max(0, (hoursLimit as number) - hoursUsed)
        : Infinity,
      hoursUsagePercent: Number.isFinite(hoursUsagePercent) ? hoursUsagePercent : 0,
      storageUsedBytes,
      storageRemainingBytes: Math.max(0, planStorageLimitBytes - storageUsedBytes),
      storageUsagePercent: Number.isFinite(storageUsagePercent) ? storageUsagePercent : 0,
      streamUsagePercent: Number.isFinite(streamUsagePercent) ? streamUsagePercent : 0,
    }
  }, [assets, planDailyLimitHours, planStorageLimitBytes, planStreamLimit, presentedStreams, quota, streams])

  const liveCount = presentedStreams.filter(({ derived }) => derived.isRunning).length
  const attentionCount = presentedStreams.filter(({ derived }) => derived.requiresAttention).length
  const nextAction = useMemo(
    () =>
      deriveDashboardNextAction({
        assetCount: usage.assetsCount,
        destinationCount: quota?.destinations.count ?? 0,
        streams: streams ?? [],
        liveStatusMap,
      }),
    [liveStatusMap, quota?.destinations.count, streams, usage.assetsCount],
  )
  const isFirstRun = nextAction.key === 'upload' || nextAction.key === 'connect' || nextAction.key === 'create'

  const hero = useMemo(() => {
    switch (nextAction.key) {
      case 'upload':
        return {
          badge: dashboard('hero.badges.setup'),
          title: dashboard('hero.upload.title'),
          description: dashboard('hero.upload.description'),
          primary: dashboard('hero.upload.primary'),
          secondary: dashboard('hero.upload.secondary'),
          primaryHref: '/dashboard/library?tab=assets',
          secondaryHref: '/dashboard/streaming',
        }
      case 'connect':
        return {
          badge: dashboard('hero.badges.setup'),
          title: dashboard('hero.connect.title'),
          description: dashboard('hero.connect.description'),
          primary: dashboard('hero.connect.primary'),
          secondary: dashboard('hero.connect.secondary'),
          primaryHref: '/dashboard/streaming',
          secondaryHref: '/dashboard/library?tab=assets',
        }
      case 'create':
        return {
          badge: dashboard('hero.badges.setup'),
          title: dashboard('hero.create.title'),
          description: dashboard('hero.create.description'),
          primary: dashboard('hero.create.primary'),
          secondary: dashboard('hero.create.secondary'),
          primaryHref: '/dashboard/streaming',
          secondaryHref: '/dashboard/library?tab=assets',
        }
      case 'attention':
        return {
          badge: dashboard('hero.badges.attention'),
          title: dashboard('hero.attention.title', { count: attentionCount }),
          description: dashboard('hero.attention.description'),
          primary: dashboard('hero.attention.primary'),
          secondary: dashboard('hero.attention.secondary'),
          primaryHref: '/dashboard/streaming',
          secondaryHref: '/dashboard/plans',
        }
      case 'resume':
        return {
          badge: dashboard('hero.badges.live'),
          title: dashboard('hero.resume.title'),
          description: dashboard('hero.resume.description'),
          primary: dashboard('hero.resume.primary'),
          secondary: dashboard('hero.resume.secondary'),
          primaryHref: '/dashboard/streaming',
          secondaryHref: '/dashboard/library?tab=assets',
        }
      default:
        return {
          badge: dashboard('hero.badges.live'),
          title: dashboard('hero.live.title', { count: liveCount }),
          description: dashboard('hero.live.description'),
          primary: dashboard('hero.live.primary'),
          secondary: dashboard('hero.live.secondary'),
          primaryHref: '/dashboard/streaming',
          secondaryHref: '/dashboard/library?tab=assets',
        }
    }
  }, [attentionCount, dashboard, liveCount, nextAction.key])

  const initialLoading =
    (!streams && !assets && (streamsLoading || assetsLoading)) ||
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.75fr,1fr]">
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),260px] xl:items-start">
              <div className="min-w-0 max-w-2xl space-y-3">
                <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 dark:border-primary-900/40 dark:bg-primary-900/20 dark:text-primary-300">
                  {hero.badge}
                </span>
                <div className="space-y-2">
                  <h3 className="text-2xl font-semibold text-slate-900 dark:text-white">{hero.title}</h3>
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">{hero.description}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => router.push(hero.primaryHref)}>
                    {hero.primary}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Button variant="outline" onClick={() => router.push(hero.secondaryHref)}>
                    {hero.secondary}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {dashboard('hero.metrics.live')}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{liveCount}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {dashboard('hero.metrics.attention')}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{attentionCount}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {dashboard('hero.metrics.files')}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{usage.assetsCount}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

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
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="space-y-6 xl:col-span-2">
          <StreamControlWidget
            streams={streams}
            liveStatusMap={liveStatusMap}
            loading={streamsLoading}
            onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: ['streams'] })
            }}
          />

          <Card>
            <CardHeader>
              <CardTitle>{dashboard('overview.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {dashboard('overview.cards.live')}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                    {liveCount}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {dashboard('overview.cards.planned')}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                    {presentedStreams.filter(({ derived }) => derived.group === 'scheduled').length}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {dashboard('overview.cards.attention')}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                    {attentionCount}
                  </p>
                </div>
              </div>

              {attentionCount > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">{dashboard('overview.attention.title')}</p>
                    <p className="mt-1">{dashboard('overview.attention.description')}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <PlanLimitsCard
            planKey={planKey}
            plan={plan}
            storageUsedBytes={usage.storageUsedBytes}
            hoursUsed={usage.hoursUsed}
            activeStreams={usage.activeStreams.length}
            assetsCount={usage.assetsCount}
            onUpgrade={() => window.location.assign('/dashboard/plans')}
          />

          <BroadcasterLevel
            totalStreamHours={usage.totalLifetimeHours + usage.hoursUsed}
            totalAssets={usage.assetsCount}
          />

          {isFirstRun && (
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
          )}
        </div>
      </div>
    </div>
  )
}
