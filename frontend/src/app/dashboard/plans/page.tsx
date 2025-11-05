'use client'

import { useState } from 'react'
import { useMessages, useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Check, Minus, Sparkles } from 'lucide-react'

type PlanQuality = 'fhd' | 'uhd'

type PlanId =
  | 'free'
  | 'fhd_start'
  | 'fhd_flow'
  | 'fhd_boost'
  | 'uhd_start'
  | 'uhd_flow'
  | 'uhd_boost'

type PlanConfig = {
  id: PlanId
  quality: PlanQuality | 'free'
  href: string
  featured: boolean
  badgeVariant: 'success' | 'secondary'
  ctaVariant: 'primary' | 'secondary'
}

const PLAN_CONFIGS: Record<PlanId, PlanConfig> = {
  free: {
    id: 'free',
    quality: 'free',
    href: '/dashboard',
    featured: false,
    badgeVariant: 'secondary',
    ctaVariant: 'secondary',
  },
  fhd_start: {
    id: 'fhd_start',
    quality: 'fhd',
    href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%20FHD%20Start',
    featured: false,
    badgeVariant: 'secondary',
    ctaVariant: 'secondary',
  },
  fhd_flow: {
    id: 'fhd_flow',
    quality: 'fhd',
    href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%20FHD%20Flow',
    featured: true,
    badgeVariant: 'success',
    ctaVariant: 'primary',
  },
  fhd_boost: {
    id: 'fhd_boost',
    quality: 'fhd',
    href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%20FHD%20Boost',
    featured: false,
    badgeVariant: 'secondary',
    ctaVariant: 'secondary',
  },
  uhd_start: {
    id: 'uhd_start',
    quality: 'uhd',
    href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%204K%20Start',
    featured: true,
    badgeVariant: 'success',
    ctaVariant: 'primary',
  },
  uhd_flow: {
    id: 'uhd_flow',
    quality: 'uhd',
    href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%204K%20Flow',
    featured: false,
    badgeVariant: 'secondary',
    ctaVariant: 'secondary',
  },
  uhd_boost: {
    id: 'uhd_boost',
    quality: 'uhd',
    href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%204K%20Boost',
    featured: false,
    badgeVariant: 'secondary',
    ctaVariant: 'secondary',
  },
}

const QUALITY_PLAN_ORDER: Record<PlanQuality, PlanId[]> = {
  fhd: ['fhd_start', 'fhd_flow', 'fhd_boost'],
  uhd: ['uhd_start', 'uhd_flow', 'uhd_boost'],
}

const QUALITY_TOGGLE_ORDER: PlanQuality[] = ['fhd', 'uhd']

type PlanMessage = {
  name: string
  price: string
  period: string
  summary: string
  highlights: string[]
  badge?: string
  ctaLabel: string
}

type ComparisonMessages = {
  title: string
  featureHeader: string
  qualityLabels: Record<PlanQuality, string>
  qualities: Record<PlanQuality, {
    rows: Record<string, { label: string; values: Record<PlanId, string> }>
    booleanRows: Record<string, { label: string; values: Record<PlanId, boolean> }>
  }>
}

type FaqMessage = {
  title: string
  description: string
  email: string
  call: string
  brief: string
}

export default function PlansPage() {
  const tPlans = useTranslations('plans.page')
  const messages = useMessages() as {
    plans?: {
      page?: {
        plans?: Record<PlanId, PlanMessage>
        comparison?: ComparisonMessages
        faq?: FaqMessage
        qualityToggle?: Record<PlanQuality, string>
      }
    }
  }

  const [quality, setQuality] = useState<PlanQuality>('fhd')

  const planMessages = messages.plans?.page?.plans ?? ({} as Record<PlanId, PlanMessage>)
  const comparisonMessages = messages.plans?.page?.comparison ?? ({} as ComparisonMessages)
  const faqMessages = messages.plans?.page?.faq ?? ({} as FaqMessage)
  const qualityToggleMessages = messages.plans?.page?.qualityToggle ?? ({} as Record<PlanQuality, string>)

  const activePlanOrder = ['free', ...QUALITY_PLAN_ORDER[quality]] as PlanId[]
  const activeComparison = comparisonMessages.qualities?.[quality] ?? {
    rows: {},
    booleanRows: {},
  }

  return (
    <div className="space-y-14 pb-16">
      <section className="max-w-3xl">
        <Badge variant="secondary" className="mb-3 inline-flex items-center space-x-1">
          <Sparkles className="h-3.5 w-3.5" />
          <span>{tPlans('header.badge')}</span>
        </Badge>
        <h1 className="text-3xl font-bold gradient-text mb-2">{tPlans('header.title')}</h1>
        <p className="text-slate-600 dark:text-slate-400">{tPlans('header.description')}</p>
      </section>

      <section>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
            {QUALITY_TOGGLE_ORDER.map((tier) => {
              const label = qualityToggleMessages[tier] ?? tier.toUpperCase()
              const isActive = tier === quality
              return (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setQuality(tier)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {activePlanOrder.map((planId) => {
            const planConfig = PLAN_CONFIGS[planId]
            const planData = planMessages[planConfig.id] ?? ({} as PlanMessage)
            const highlights = Array.isArray(planData.highlights) ? planData.highlights : []
            const badgeText = planData.badge
            const planName = planData.name ?? planId
            const planPrice = planData.price ?? ''
            const planPeriod = planData.period ?? ''
            const planSummary = planData.summary ?? ''
            const ctaLabel = planData.ctaLabel ?? ''

            return (
              <Card
                key={planConfig.id}
                className={`relative flex h-full flex-col border-2 transition-shadow duration-300 hover:scale-100 ${
                  planConfig.featured
                    ? 'border-primary-400 shadow-xl shadow-primary-500/10 hover:shadow-primary-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:shadow-lg'
                }`}
              >
                {badgeText ? (
                  <Badge variant={planConfig.badgeVariant} className="absolute right-4 top-4">
                    {badgeText}
                  </Badge>
                ) : null}
                <CardHeader>
                  <CardTitle className="text-xl font-semibold">{planName}</CardTitle>
                  <div className="mt-4">
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">{planPrice}</p>
                    <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {planPeriod}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="flex h-full flex-col justify-between space-y-6">
                  <p className="text-sm text-slate-600 dark:text-slate-400">{planSummary}</p>
                  <ul className="space-y-3 text-sm">
                    {highlights.map((highlight) => (
                      <li key={highlight} className="flex items-start space-x-2 text-slate-700 dark:text-slate-200">
                        <Check className="mt-0.5 h-4 w-4 text-primary-500" />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant={planConfig.ctaVariant}
                    onClick={() => {
                      if (planConfig.href.startsWith('http')) {
                        window.open(planConfig.href, '_blank', 'noopener')
                      } else {
                        window.open(planConfig.href, '_self')
                      }
                    }}
                  >
                    {ctaLabel}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="space-y-10">
        <Card className="rounded-3xl border border-slate-200/70 bg-white/90 shadow-lg hover:scale-100 dark:border-slate-800/70 dark:bg-slate-900/80">
          <CardHeader>
            <CardTitle>{comparisonMessages.title ?? tPlans('comparison.title')}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <th className="px-4 py-3">{comparisonMessages.featureHeader ?? tPlans('comparison.featureHeader')}</th>
                  {activePlanOrder.map((planId) => (
                    <th key={planId} className="px-4 py-3 text-center">
                      {planMessages[planId]?.name ?? planId}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {Object.entries(activeComparison.rows ?? {}).map(([rowId, row]) => (
                  <tr key={rowId} className="text-slate-700 dark:text-slate-200">
                    <td className="px-4 py-3 font-medium">{row.label}</td>
                    {activePlanOrder.map((planId) => (
                      <td key={`${rowId}-${planId}`} className="px-4 py-3 text-center">
                        {row.values?.[planId] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
                {Object.entries(activeComparison.booleanRows ?? {}).map(([rowId, row]) => (
                  <tr key={rowId} className="text-slate-700 dark:text-slate-200">
                    <td className="px-4 py-3 font-medium">{row.label}</td>
                    {activePlanOrder.map((planId) => {
                      const isEnabled = row.values?.[planId] ?? false
                      return (
                        <td key={`${rowId}-${planId}`} className="px-4 py-3 text-center">
                          {isEnabled ? (
                            <Check className="mx-auto h-4 w-4 text-primary-500" />
                          ) : (
                            <Minus className="mx-auto h-4 w-4 text-slate-300 dark:text-slate-700" />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/70 bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:border-slate-800/70 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
          <CardHeader>
            <CardTitle>{faqMessages.title ?? tPlans('faq.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
            <p>{faqMessages.description ?? tPlans('faq.description')}</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => window.open('mailto:support@youtubestreaming.app', '_self')}>
                {faqMessages.email ?? tPlans('faq.email')}
              </Button>
              <Button variant="secondary" onClick={() => window.open('https://cal.com/', '_blank', 'noopener')}>
                {faqMessages.call ?? tPlans('faq.call')}
              </Button>
              <Button variant="ghost" onClick={() => window.open('https://docs.google.com/', '_blank', 'noopener')}>
                {faqMessages.brief ?? tPlans('faq.brief')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
