'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatBytes, formatUptime } from '@/lib/utils'
import { Cpu, HardDrive, Radio, Zap } from 'lucide-react'
import { StatCard } from '@/components/StatCard'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { QuotaWidget } from '@/components/QuotaWidget'
import { SubscriptionBanner } from '@/components/SubscriptionBanner'
import { QuickActions } from '@/components/QuickActions'
import { useDashboardContext } from './dashboard-context'

export default function DashboardPage() {
  const { user } = useDashboardContext()

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: api.metrics.get,
    refetchInterval: 5000,
    enabled: !!user,
  })

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-3xl font-bold gradient-text mb-2">Dashboard</h2>
        <p className="text-slate-600 dark:text-slate-400">Monitor your streaming infrastructure</p>
      </div>

      {/* NEW: Subscription Banner */}
      <div className="mb-6">
        <SubscriptionBanner tier="free" onUpgrade={() => console.log('Upgrade clicked')} />
      </div>

      {/* NEW: Quick Actions */}
      <div className="mb-6">
        <QuickActions />
      </div>

      {metricsLoading ? (
        <LoadingState />
      ) : metrics ? (
        <>
          {/* Metrics Grid */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
            <StatCard
              title="CPU Usage"
              value={`${metrics.system.cpu.percent.toFixed(1)}%`}
              icon={Cpu}
              gradient="from-primary-500 to-purple-500"
              delay={0}
            />
            <StatCard
              title="Memory Usage"
              value={`${metrics.system.memory.percent.toFixed(1)}%`}
              icon={HardDrive}
              gradient="from-accent-500 to-cyan-500"
              delay={0.1}
            />
            <StatCard
              title="Active Streams"
              value={metrics.streams.active_streams}
              icon={Radio}
              gradient="from-success-500 to-emerald-500"
              delay={0.2}
            />
            <StatCard
              title="Capacity"
              value={`+${metrics.capacity.estimated_additional_capacity}`}
              icon={Zap}
              gradient="from-warning-500 to-orange-500"
              delay={0.3}
            />
          </div>

          {/* System Info + Quota Widget */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>System Information</CardTitle>
                </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">CPU Cores</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-white mt-1">{metrics.system.cpu.count}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Memory Available</p>
                    <p className="text-lg font-semibold text-slate-900 dark:text-white mt-1">{metrics.system.memory.available_gb.toFixed(2)} GB</p>
                  </div>
                  {metrics.system.disk && (
                    <>
                      <div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Disk Space</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-white mt-1">
                          {metrics.system.disk.free_gb.toFixed(2)} GB free / {metrics.system.disk.total_gb.toFixed(2)} GB
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Disk Usage</p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-white mt-1">{metrics.system.disk.percent.toFixed(1)}%</p>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
              </Card>
            </div>

            {/* NEW: Quota Widget */}
            <div className="lg:col-span-1">
              <QuotaWidget
                quota={{
                  storage: { used_gb: 2.5, limit_gb: 5, percent: 50 },
                  streams: { active: 0, limit: 1, percent: 0 },
                  assets: { count: 5, limit: 20, percent: 25 },
                  playlists: { count: 1, limit: 3, percent: 33 },
                  destinations: { count: 1, limit: 2, percent: 50 },
                  tier: 'free'
                }}
              />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Stream Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center p-4 rounded-xl bg-success-50 dark:bg-success-900/20">
                  <p className="text-sm font-medium text-success-600 dark:text-success-400 mb-2">Running</p>
                  <p className="text-3xl font-bold text-success-700 dark:text-success-300">{metrics.streams.active_streams}</p>
                </div>
                <div className="text-center p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Stopped</p>
                  <p className="text-3xl font-bold text-slate-700 dark:text-slate-300">{metrics.streams.idle_streams}</p>
                </div>
                <div className="text-center p-4 rounded-xl bg-error-50 dark:bg-error-900/20">
                  <p className="text-sm font-medium text-error-600 dark:text-error-400 mb-2">Error</p>
                  <p className="text-3xl font-bold text-error-700 dark:text-error-300">{metrics.streams.error_streams}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="text-center py-12">
          <p className="text-slate-500 dark:text-slate-400">No metrics available</p>
        </Card>
      )}
    </div>
  )
}
