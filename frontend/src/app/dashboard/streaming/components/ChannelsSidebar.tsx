'use client'

import { motion } from 'framer-motion'
import { Plus, TvMinimal, Loader2, Edit, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { LoadingState } from '@/components/LoadingState'
import { cn } from '@/lib/utils'
import type { Destination } from '@/lib/types'

type TranslationFn = ReturnType<typeof useTranslations>

export type ChannelsSidebarProps = {
  destinations?: Destination[]
  isLoading: boolean
  selectedChannelId: string | null
  onSelectChannel: (id: string) => void
  onCreateChannel: () => void
  onEditChannel: (destination: Destination) => void
  onDeleteChannel: (id: string) => void
  t: TranslationFn
  quotaLoading: boolean
  destinationsLimit: number | null
  formatLimitValue: (value?: number | null) => string
}

export function ChannelsSidebar({
  destinations,
  isLoading,
  selectedChannelId,
  onSelectChannel,
  onCreateChannel,
  onEditChannel,
  onDeleteChannel,
  t,
  quotaLoading,
  destinationsLimit,
  formatLimitValue,
}: ChannelsSidebarProps) {
  return (
    <div className="lg:col-span-1">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center space-x-2">
            <TvMinimal className="w-5 h-5" />
            <CardTitle className="text-base">{t('channels.title')}</CardTitle>
          </div>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onCreateChannel}>
            <Plus className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <LoadingState />
          ) : destinations && destinations.length > 0 ? (
            <>
              {destinations.map((destination) => (
                <motion.div key={destination.id} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <div
                    onClick={() => onSelectChannel(destination.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelectChannel(destination.id)
                      }
                    }}
                    className={cn(
                      'w-full text-left p-3 rounded-lg border transition-all cursor-pointer',
                      selectedChannelId === destination.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{destination.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-1">
                          {destination.rtmps_url.split('/').pop()}
                        </p>
                      </div>
                      <Badge variant={destination.enabled ? 'success' : 'secondary'} className="ml-2">
                        {destination.enabled ? t('channels.badge.active') : t('channels.badge.disabled')}
                      </Badge>
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={(event) => {
                          event.stopPropagation()
                          onEditChannel(destination)
                        }}
                      >
                        <Edit className="w-3 h-3 mr-1" />
                        {t('channels.actions.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-error-600"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDeleteChannel(destination.id)
                        }}
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        {t('channels.actions.delete')}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}

              <Button size="sm" variant="outline" className="w-full mt-2" onClick={onCreateChannel}>
                <Plus className="w-4 h-4 mr-2" />
                {t('channels.add')}
              </Button>
            </>
          ) : (
            <div className="text-center py-8">
              <TvMinimal className="w-12 h-12 mx-auto text-slate-400 mb-3" />
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{t('channels.empty.title')}</p>
              <Button size="sm" variant="outline" className="w-full" onClick={onCreateChannel}>
                <Plus className="w-4 h-4 mr-2" />
                {t('channels.add')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600 dark:text-slate-400">{t('channels.stats.total')}</span>
              <span className="text-lg font-bold">
                {quotaLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  `${destinations?.length || 0}/${formatLimitValue(destinationsLimit)}`
                )}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600 dark:text-slate-400">{t('channels.stats.active')}</span>
              <span className="text-lg font-bold text-success-600">
                {destinations?.filter((channel) => channel.enabled).length || 0}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
