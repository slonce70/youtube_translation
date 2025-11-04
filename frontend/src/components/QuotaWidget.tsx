'use client'

import { motion } from 'framer-motion'
import { HardDrive, Radio, Upload, ListVideo, TvMinimal, TrendingUp } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { cn } from '@/lib/utils'

interface QuotaUsage {
  storage: { used_gb: number; limit_gb: number; percent: number }
  streams: { active: number; limit: number; percent: number }
  assets: { count: number; limit: number; percent: number }
  playlists: { count: number; limit: number; percent: number }
  destinations: { count: number; limit: number; percent: number }
  tier: string
}

interface QuotaWidgetProps {
  quota?: QuotaUsage
  loading?: boolean
}

export function QuotaWidget({ quota, loading }: QuotaWidgetProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resource Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 animate-pulse">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-200 dark:bg-slate-700 rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!quota) {
    return null
  }

  const resources = [
    {
      label: 'Storage',
      icon: HardDrive,
      current: `${quota.storage.used_gb} GB`,
      limit: `${quota.storage.limit_gb} GB`,
      percent: quota.storage.percent,
      color: 'from-blue-500 to-cyan-500',
    },
    {
      label: 'Concurrent Streams',
      icon: Radio,
      current: quota.streams.active,
      limit: quota.streams.limit,
      percent: quota.streams.percent,
      color: 'from-purple-500 to-pink-500',
    },
    {
      label: 'Video Assets',
      icon: Upload,
      current: quota.assets.count,
      limit: quota.assets.limit,
      percent: quota.assets.percent,
      color: 'from-green-500 to-emerald-500',
    },
    {
      label: 'Playlists',
      icon: ListVideo,
      current: quota.playlists.count,
      limit: quota.playlists.limit,
      percent: quota.playlists.percent,
      color: 'from-amber-500 to-orange-500',
    },
    {
      label: 'Channels',
      icon: TvMinimal,
      current: quota.destinations.count,
      limit: quota.destinations.limit,
      percent: quota.destinations.percent,
      color: 'from-red-500 to-rose-500',
    },
  ]

  const getStatusColor = (percent: number) => {
    if (percent >= 90) return 'text-error-600'
    if (percent >= 70) return 'text-warning-600'
    return 'text-success-600'
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Resource Usage</CardTitle>
        <Badge variant="secondary" className="capitalize">
          {quota.tier} Plan
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {resources.map((resource, index) => {
            const Icon = resource.icon
            const isNearLimit = resource.percent >= 80

            return (
              <motion.div
                key={resource.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={cn(
                  'p-3 rounded-lg border transition-colors',
                  isNearLimit
                    ? 'border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-900/10'
                    : 'border-slate-200 dark:border-slate-700'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-3">
                    <div className={cn('p-2 rounded-lg bg-gradient-to-br', resource.color)}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{resource.label}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {resource.current} / {resource.limit}
                      </p>
                    </div>
                  </div>
                  <span className={cn('text-sm font-bold', getStatusColor(resource.percent))}>
                    {resource.percent.toFixed(0)}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="relative h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${resource.percent}%` }}
                    transition={{ duration: 1, delay: index * 0.1 + 0.2 }}
                    className={cn(
                      'absolute top-0 left-0 h-full rounded-full bg-gradient-to-r',
                      resource.percent >= 90
                        ? 'from-error-500 to-error-600'
                        : resource.percent >= 70
                        ? 'from-warning-500 to-warning-600'
                        : resource.color
                    )}
                  />
                </div>

                {isNearLimit && (
                  <p className="text-xs text-warning-600 dark:text-warning-400 mt-2 flex items-center space-x-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>Approaching limit</span>
                  </p>
                )}
              </motion.div>
            )
          })}
        </div>

        {/* Upgrade CTA */}
        {quota.tier === 'free' && (
          <div className="mt-6 p-4 rounded-lg bg-gradient-to-br from-primary-50 to-accent-50 dark:from-primary-900/20 dark:to-accent-900/20 border border-primary-200 dark:border-primary-800">
            <p className="text-sm font-medium mb-2">Need more resources?</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
              Upgrade to Pro for 50GB storage, 5 concurrent streams, and more.
            </p>
            <Button size="sm" className="w-full">
              <TrendingUp className="w-4 h-4 mr-2" />
              Upgrade to Pro
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
