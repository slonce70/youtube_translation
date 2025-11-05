'use client'

import { useRouter } from 'next/navigation'
import { bytesToGigabytes, formatBytes, formatHoursHuman } from '@/lib/utils'
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
  const storageRemainingBytes = Math.max(0, storageLimitBytes - storageUsedBytes)
  const resetLabel = 'Daily limits reset at midnight'
  const storageLimitGb = bytesToGigabytes(storageLimitBytes)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Free Plan Usage</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">Track how close you are to plan limits</p>
        </div>
        <Badge>Free Tier</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Library storage</span>
            <span>{formatBytes(storageUsedBytes)} of {storageLimitGb.toFixed(0)} GB</span>
          </div>
          <Progress value={storageUsagePercent} indicatorClassName={storageUsagePercent >= 90 ? 'bg-error-500' : undefined} className="mt-2" />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Remaining {formatBytes(storageRemainingBytes)}</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Assets in library: {assetsCount}</p>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Daily streaming time</span>
            <span>{formatHoursHuman(hoursUsed)} of {formatHoursHuman(hoursLimit)}</span>
          </div>
          <Progress value={hoursUsagePercent} indicatorClassName={hoursUsagePercent >= 90 ? 'bg-error-500' : undefined} className="mt-2" />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Remaining {formatHoursHuman(Math.max(0, hoursLimit - hoursUsed))}</p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
          <div>
            <p className="text-xs uppercase text-slate-400 dark:text-slate-500 tracking-wide">Concurrent streams</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{activeStreams} / {streamLimit}</p>
          </div>
          <Badge variant={activeStreams >= streamLimit ? 'warning' : 'success'}>
            {activeStreams >= streamLimit ? 'Limit reached' : 'Available'}
          </Badge>
        </div>

        <div className="rounded-lg border border-primary-200 dark:border-primary-900/40 bg-primary-50/60 dark:bg-primary-900/10 p-4">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-lg bg-primary-500 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">Need more headroom?</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Upgrade to unlock additional storage, longer broadcasts, and more destinations.</p>
              <div className="mt-3 flex flex-col space-y-2">
                <Button size="sm" onClick={() => router.push('/dashboard/plans')}>
                  Compare plans
                </Button>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">{resetLabel}</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
