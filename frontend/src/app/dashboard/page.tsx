'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HardDrive, Clock3, Radio, Video, Lightbulb } from 'lucide-react'
import { api } from '@/lib/api'
import { formatBytes, formatHoursHuman } from '@/lib/utils'
import { StatCard } from '@/components/StatCard'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { SubscriptionBanner } from '@/components/SubscriptionBanner'
import { QuickActions } from '@/components/QuickActions'
import { StreamControlWidget } from '@/components/StreamControlWidget'
import { PlanLimitsCard } from '@/components/PlanLimitsCard'
import { Progress } from '@/components/ui/Progress'
import { useDashboardContext } from './dashboard-context'
import type { MetricsResponse, Stream, Asset } from '@/lib/types'

const STORAGE_LIMIT_GB = 3
const STORAGE_LIMIT_BYTES = STORAGE_LIMIT_GB * Math.pow(1024, 3)
const DAILY_STREAMING_LIMIT_HOURS = 8
const CONCURRENT_STREAM_LIMIT = 1

const formatHoursLabel = (hours: number) => formatHoursHuman(Math.max(0, hours))

export default function DashboardPage() {
  const { user } = useDashboardContext()

  const { data: metrics, isLoading: metricsLoading } = useQuery<MetricsResponse>({
    queryKey: ['metrics'],
    queryFn: api.metrics.get,
    refetchInterval: 5000,
    enabled: !!user,
  })

  const { data: streams, isLoading: streamsLoading } = useQuery<Stream[]>({
    queryKey: ['streams'],
    queryFn: api.streams.list,
    refetchInterval: 5000,
    enabled: !!user,
  })

  const { data: assets, isLoading: assetsLoading } = useQuery<Asset[]>({
    queryKey: ['assets', 'dashboard'],
    queryFn: api.assets.list,
    enabled: !!user,
    staleTime: 30_000,
  })

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
    const hoursUsagePercent = Math.min(100, (hoursUsed / DAILY_STREAMING_LIMIT_HOURS) * 100)

    const storageUsedBytes = (assets ?? []).reduce((total, asset) => total + (asset.size_bytes ?? 0), 0)
    const storageUsagePercent = Math.min(100, (storageUsedBytes / STORAGE_LIMIT_BYTES) * 100)

    const streamUsagePercent = Math.min(
      100,
      (activeStreams.length / CONCURRENT_STREAM_LIMIT) * 100
    )

    return {
      activeStreams,
      assetsCount: assets?.length ?? 0,
      hoursUsed,
      hoursRemaining: Math.max(0, DAILY_STREAMING_LIMIT_HOURS - hoursUsed),
      hoursUsagePercent: Number.isFinite(hoursUsagePercent) ? hoursUsagePercent : 0,
      storageUsedBytes,
      storageRemainingBytes: Math.max(0, STORAGE_LIMIT_BYTES - storageUsedBytes),
      storageUsagePercent: Number.isFinite(storageUsagePercent) ? storageUsagePercent : 0,
      streamUsagePercent: Number.isFinite(streamUsagePercent) ? streamUsagePercent : 0,
    }
  }, [assets, streams])

  const initialLoading =
    !metrics && !streams && !assets && (metricsLoading || streamsLoading || assetsLoading)

  if (initialLoading) {
    return <LoadingState />
  }

  const statCards = [
    {
      title: 'Storage used',
      value: `${formatBytes(usage.storageUsedBytes)} / ${STORAGE_LIMIT_GB} GB`,
      icon: HardDrive,
      gradient: 'from-primary-500 to-cyan-500',
    },
    {
      title: 'Streaming time left',
      value: formatHoursLabel(usage.hoursRemaining),
      icon: Clock3,
      gradient: 'from-purple-500 to-pink-500',
    },
    {
      title: 'Active streams',
      value: `${usage.activeStreams.length} / ${CONCURRENT_STREAM_LIMIT}`,
      icon: Radio,
      gradient: 'from-success-500 to-emerald-500',
    },
    {
      title: 'Library assets',
      value: usage.assetsCount,
      icon: Video,
      gradient: 'from-amber-500 to-orange-500',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold gradient-text mb-2">Dashboard</h2>
        <p className="text-slate-600 dark:text-slate-400">
          Keep an eye on your limits and jump back into streaming in a click.
        </p>
      </div>

      <SubscriptionBanner
        tier="free"
        onUpgrade={() => window.location.assign('/dashboard/plans')}
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
              <CardTitle>Usage overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>Library storage</span>
                  <span>{formatBytes(usage.storageUsedBytes)} used</span>
                </div>
                <Progress value={usage.storageUsagePercent} className="mt-2" indicatorClassName={usage.storageUsagePercent >= 90 ? 'bg-error-500' : undefined} />
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Remaining {formatBytes(usage.storageRemainingBytes)} of {STORAGE_LIMIT_GB} GB
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>Daily streaming time</span>
                  <span>{formatHoursLabel(usage.hoursUsed)} used</span>
                </div>
                <Progress value={usage.hoursUsagePercent} className="mt-2" indicatorClassName={usage.hoursUsagePercent >= 90 ? 'bg-error-500' : undefined} />
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Remaining {formatHoursLabel(usage.hoursRemaining)} of {formatHoursLabel(DAILY_STREAMING_LIMIT_HOURS)}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>Concurrent stream slot</span>
                  <span>{usage.activeStreams.length} of {CONCURRENT_STREAM_LIMIT}</span>
                </div>
                <Progress value={usage.streamUsagePercent} className="mt-2" indicatorClassName={usage.streamUsagePercent >= 90 ? 'bg-error-500' : undefined} />
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Upgrade to run parallel broadcasts or add redundancy destinations.
                </p>
              </div>
            </CardContent>
          </Card>

          <QuickActions />

          <StreamControlWidget streams={streams} loading={streamsLoading} />
        </div>

        <div className="space-y-6">
          <PlanLimitsCard
            storageUsedBytes={usage.storageUsedBytes}
            storageLimitBytes={STORAGE_LIMIT_BYTES}
            storageUsagePercent={usage.storageUsagePercent}
            hoursUsed={usage.hoursUsed}
            hoursLimit={DAILY_STREAMING_LIMIT_HOURS}
            hoursUsagePercent={usage.hoursUsagePercent}
            activeStreams={usage.activeStreams.length}
            streamLimit={CONCURRENT_STREAM_LIMIT}
            assetsCount={usage.assetsCount}
          />

          <Card>
            <CardHeader>
              <CardTitle>Streaming checklist</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
              <div className="flex items-start space-x-3">
                <Lightbulb className="h-4 w-4 text-primary-500 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-700 dark:text-slate-200">Warm up your feed</p>
                  <p>Use Go Live a few minutes early to confirm ingest quality before the audience arrives.</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Lightbulb className="h-4 w-4 text-primary-500 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-700 dark:text-slate-200">Rotate uploads</p>
                  <p>Archive older assets once you finish streaming to reclaim storage for new content.</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Lightbulb className="h-4 w-4 text-primary-500 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-700 dark:text-slate-200">Plan the next upgrade</p>
                  <p>Hit Compare plans whenever you get close to limits so live events never pause for capacity.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
