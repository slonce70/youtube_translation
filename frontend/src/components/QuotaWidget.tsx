'use client'

import { motion } from 'framer-motion'
import { HardDrive, Radio, Upload, ListVideo, TvMinimal, TrendingUp, Timer } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

interface QuotaUsage {
  storage: { used_gb: number; limit_gb: number; percent: number }
  streams: { active: number; limit: number; percent: number }
  assets: { count: number; limit: number; percent: number }
  playlists: { count: number; limit: number; percent: number }
  destinations: { count: number; limit: number; percent: number }
  streaming_hours: { used: number; limit: number | null; percent: number; unlimited: boolean }
  quality: { max_resolution: string; max_resolution_height: number | null; max_fps: number | null; allowed_video_codecs: string[]; enforce_stream_quality: boolean }
  tier: string
}

interface QuotaWidgetProps {
  quota?: QuotaUsage
  loading?: boolean
}

export function QuotaWidget({ quota, loading }: QuotaWidgetProps) {
  const t = useTranslations('dashboard.quota')

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
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

  const tierKey = quota.tier.toLowerCase()
  const tierLabel = t(`tiers.${tierKey}` as any)
  const resolutionLabel = quota.quality.max_resolution_height
    ? `${quota.quality.max_resolution_height}p`
    : quota.quality.max_resolution
  const codecsLabel = (quota.quality.allowed_video_codecs || []).join(', ') || '—'

  const resources = (
    [
      {
        key: 'storage',
        icon: HardDrive,
        current: `${quota.storage.used_gb} GB`,
        limit: `${quota.storage.limit_gb} GB`,
        percent: quota.storage.percent,
        color: 'from-blue-500 to-cyan-500',
      },
      {
        key: 'streams',
        icon: Radio,
        current: quota.streams.active,
        limit: quota.streams.limit,
        percent: quota.streams.percent,
        color: 'from-purple-500 to-pink-500',
      },
      {
        key: 'streamingHours',
        icon: Timer,
        current: `${quota.streaming_hours.used.toFixed(1)} h`,
        limit: quota.streaming_hours.unlimited
          ? t('limits.unlimited')
          : `${Number(quota.streaming_hours.limit ?? 0).toFixed(0)} h`,
        percent: quota.streaming_hours.percent,
        color: 'from-sky-500 to-cyan-500',
      },
      {
        key: 'assets',
        icon: Upload,
        current: quota.assets.count,
        limit: quota.assets.limit,
        percent: quota.assets.percent,
        color: 'from-green-500 to-emerald-500',
      },
      {
        key: 'playlists',
        icon: ListVideo,
        current: quota.playlists.count,
        limit: quota.playlists.limit,
        percent: quota.playlists.percent,
        color: 'from-amber-500 to-orange-500',
      },
      {
        key: 'destinations',
        icon: TvMinimal,
        current: quota.destinations.count,
        limit: quota.destinations.limit,
        percent: quota.destinations.percent,
        color: 'from-red-500 to-rose-500',
      },
    ] as const
  ).map((resource) => ({
    ...resource,
    label: t(`resources.${resource.key}` as any),
  }))

  const getStatusColor = (percent: number) => {
    if (percent >= 90) return 'text-error-600'
    if (percent >= 70) return 'text-warning-600'
    return 'text-success-600'
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('title')}</CardTitle>
        <Badge variant="secondary" className="capitalize">
          {t('badge', { tier: tierLabel })}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {resources.map((resource, index) => {
            const Icon = resource.icon
            const isNearLimit = resource.percent >= 80

            return (
              <motion.div
                key={resource.key}
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
                    <span>{t('nearLimit')}</span>
                  </p>
                )}
              </motion.div>
            )
          })}
        </div>

        <div className="mt-6 p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
            {t('quality.title')}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t('quality.resolution', {
              resolution: resolutionLabel,
              fps: quota.quality.max_fps ?? '—',
            })}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {t('quality.codecs', { codecs: codecsLabel })}
          </p>
        </div>

        {/* Upgrade CTA */}
        {tierKey === 'free' && (
          <div className="mt-6 p-4 rounded-lg bg-gradient-to-br from-primary-50 to-accent-50 dark:from-primary-900/20 dark:to-accent-900/20 border border-primary-200 dark:border-primary-800">
            <p className="text-sm font-medium mb-2">{t('cta.title')}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">{t('cta.description')}</p>
            <Button size="sm" className="w-full">
              <TrendingUp className="w-4 h-4 mr-2" />
              {t('cta.button')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
