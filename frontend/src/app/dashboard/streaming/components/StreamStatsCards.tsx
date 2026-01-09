import { Loader2 } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/Card'
import type { Stream } from '@/lib/types'

import type { TranslationFn } from '../types'

type Props = {
  streams?: Stream[]
  quotaLoading: boolean
  concurrentStreamsLimit: number | null
  formatLimitValue: (value?: number | null) => string
  t: TranslationFn
}

export function StreamStatsCards({
  streams,
  quotaLoading,
  concurrentStreamsLimit,
  formatLimitValue,
  t,
}: Props) {
  const runningCount = streams?.filter((stream) => stream.status === 'running').length || 0
  const totalCount = streams?.length || 0

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-success-600">{runningCount}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {t('streams.stats.active')}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-3xl font-bold gradient-text">{totalCount}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {t('streams.stats.total')}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-3xl font-bold gradient-text">
              {quotaLoading ? (
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              ) : (
                `${runningCount}/${formatLimitValue(concurrentStreamsLimit)}`
              )}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {t('streams.stats.concurrent')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
