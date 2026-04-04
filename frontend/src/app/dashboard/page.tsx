'use client'

import { useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Radio, Lightbulb, ChevronDown, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardContent } from '@/components/ui/Card'
import { SubscriptionBanner } from '@/components/SubscriptionBanner'
import { StreamControlWidget } from '@/components/StreamControlWidget'
import { PlanLimitsCard } from '@/components/PlanLimitsCard'
import { BroadcasterLevel } from '@/components/Gamification/BroadcasterLevel'
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
    const hoursUsed = quota?.streaming_hours.used ?? 0

    const totalLifetimeHours = (streams ?? []).reduce((total, stream) => {
      return total + ((stream.total_duration_seconds ?? 0) / 3600)
    }, 0)

    return {
      activeStreams,
      assetsCount: quota?.assets.count ?? assets?.length ?? 0,
      hoursUsed,
      totalLifetimeHours,
      storageUsedBytes,
    }
  }, [assets, presentedStreams, quota, streams])

  const liveCount = presentedStreams.filter(({ derived }) => derived.isRunning).length
  const attentionCount = presentedStreams.filter(({ derived }) => derived.requiresAttention).length
  const scheduledCount = presentedStreams.filter(({ derived }) => derived.group === 'scheduled').length
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
          title: dashboard('hero.upload.title'),
          description: dashboard('hero.upload.description'),
          primary: dashboard('hero.upload.primary'),
          primaryHref: '/dashboard/library?tab=assets',
        }
      case 'connect':
        return {
          title: dashboard('hero.connect.title'),
          description: dashboard('hero.connect.description'),
          primary: dashboard('hero.connect.primary'),
          primaryHref: '/dashboard/streaming',
        }
      case 'create':
        return {
          title: dashboard('hero.create.title'),
          description: dashboard('hero.create.description'),
          primary: dashboard('hero.create.primary'),
          primaryHref: '/dashboard/streaming',
        }
      case 'attention':
        return {
          title: dashboard('hero.attention.title', { count: attentionCount }),
          description: dashboard('hero.attention.description'),
          primary: dashboard('hero.attention.primary'),
          primaryHref: '/dashboard/streaming',
        }
      case 'resume':
        return {
          title: dashboard('hero.resume.title'),
          description: dashboard('hero.resume.description'),
          primary: dashboard('hero.resume.primary'),
          primaryHref: '/dashboard/streaming',
        }
      default:
        return {
          title: dashboard('hero.live.title', { count: liveCount }),
          description: dashboard('hero.live.description'),
          primary: dashboard('hero.live.primary'),
          primaryHref: '/dashboard/streaming',
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
    <div className="space-y-6">
      <SubscriptionBanner
        tier={planKey}
        onUpgrade={() => window.location.assign('/dashboard/plans')}
      />

      {/* Compact hero banner */}
      <Card className="overflow-hidden border-l-4 border-l-primary-500">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{hero.title}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{hero.description}</p>
            </div>
            <div className="flex items-center gap-6">
              <div className="hidden sm:flex items-center gap-5">
                <div className="text-center">
                  <p className="text-2xl font-bold text-success-600">{liveCount}</p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">{dashboard('hero.metrics.live')}</p>
                </div>
                {attentionCount > 0 && (
                  <div className="text-center">
                    <p className="text-2xl font-bold text-amber-500">{attentionCount}</p>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">{dashboard('hero.metrics.attention')}</p>
                  </div>
                )}
                {scheduledCount > 0 && (
                  <div className="text-center">
                    <p className="text-2xl font-bold text-primary-500">{scheduledCount}</p>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">{dashboard('overview.cards.planned')}</p>
                  </div>
                )}
              </div>
              <Button onClick={() => router.push(hero.primaryHref)} className="shrink-0">
                {hero.primary}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inline mobile metrics */}
      <div className="grid grid-cols-3 gap-3 sm:hidden">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900/50">
          <p className="text-xl font-bold text-success-600">{liveCount}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{dashboard('hero.metrics.live')}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900/50">
          <p className="text-xl font-bold text-amber-500">{attentionCount}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{dashboard('hero.metrics.attention')}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900/50">
          <p className="text-xl font-bold text-primary-500">{scheduledCount}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{dashboard('overview.cards.planned')}</p>
        </div>
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
