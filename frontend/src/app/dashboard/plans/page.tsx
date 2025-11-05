'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Check, Minus, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useTranslations, useMessages } from 'next-intl'

type PlanId = 'free' | 'creator' | 'studio' | 'enterprise'

type PlanConfig = {
  id: PlanId
  href: string
  featured: boolean
  badgeVariant: 'success' | 'secondary'
  ctaVariant: 'primary' | 'secondary'
}

const PLAN_CONFIGS: PlanConfig[] = [
  {
    id: 'free',
    href: '/dashboard',
    featured: false,
    badgeVariant: 'secondary',
    ctaVariant: 'secondary',
  },
  {
    id: 'creator',
    href: 'mailto:support@youtubestreaming.app?subject=Creator%20upgrade%20request',
    featured: true,
    badgeVariant: 'success',
    ctaVariant: 'primary',
  },
  {
    id: 'studio',
    href: 'mailto:support@youtubestreaming.app?subject=Studio%20upgrade%20request',
    featured: false,
    badgeVariant: 'secondary',
    ctaVariant: 'secondary',
  },
  {
    id: 'enterprise',
    href: 'https://cal.com/',
    featured: false,
    badgeVariant: 'secondary',
    ctaVariant: 'secondary',
  },
]

const PLAN_ORDER: PlanId[] = PLAN_CONFIGS.map((plan) => plan.id)

const BOOLEAN_ROW_VALUES: Record<'streamCalendar' | 'customWatermark', boolean[]> = {
  streamCalendar: [false, true, true, true],
  customWatermark: [false, true, true, true],
}

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
  rows: Record<string, { label: string; values: Record<PlanId, string> }>
  booleanRows: Record<string, { label: string }>
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
      }
    }
  }

  const planMessages = messages.plans?.page?.plans ?? ({} as Record<PlanId, PlanMessage>)
  const comparisonMessages = messages.plans?.page?.comparison ?? ({} as ComparisonMessages)
  const faqMessages = messages.plans?.page?.faq ?? ({} as FaqMessage)

  return (
    <div className="space-y-14 pb-16">
      <section className="max-w-3xl">
        <Badge variant="secondary" className="mb-3 inline-flex items-center space-x-1">
          <Sparkles className="h-3.5 w-3.5" />
          <span>{tPlans('header.badge')}</span>
        </Badge>
        <h1 className="text-3xl font-bold gradient-text mb-2">{tPlans('header.title')}</h1>
        <p className="text-slate-600 dark:text-slate-400">
          {tPlans('header.description')}
        </p>
      </section>

      <section>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {PLAN_CONFIGS.map((plan) => {
            const planData = planMessages[plan.id] ?? ({} as PlanMessage)
            const highlights = Array.isArray(planData.highlights) ? planData.highlights : []
            const badgeText = planData.badge
            const planName = planData.name ?? plan.id
            const planPrice = planData.price ?? ''
            const planPeriod = planData.period ?? ''
            const planSummary = planData.summary ?? ''
            const ctaLabel = planData.ctaLabel ?? ''

            return (
              <Card
                key={plan.id}
                className={`relative flex h-full flex-col border-2 transition-shadow duration-300 hover:scale-100 ${
                  plan.featured
                    ? 'border-primary-400 shadow-xl shadow-primary-500/10 hover:shadow-primary-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:shadow-lg'
                }`}
              >
                {badgeText ? (
                  <Badge variant={plan.badgeVariant} className="absolute right-4 top-4">
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
                    variant={plan.ctaVariant}
                    onClick={() => {
                      if (plan.href.startsWith('http')) {
                        window.open(plan.href, '_blank', 'noopener')
                      } else {
                        window.open(plan.href, '_self')
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
                  {PLAN_ORDER.map((planId) => (
                    <th key={planId} className="px-4 py-3 text-center">
                      {planMessages[planId]?.name ?? planId}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {['memoryBuffer', 'dailyStreaming', 'concurrentStreams', 'destinations', 'prioritySupport'].map((rowId) => {
                  const row = comparisonMessages.rows?.[rowId] ?? { label: rowId, values: {} as Record<PlanId, string> }
                  return (
                    <tr key={rowId} className="text-slate-700 dark:text-slate-200">
                      <td className="px-4 py-3 font-medium">{row.label}</td>
                      {PLAN_ORDER.map((planId) => (
                        <td key={`${rowId}-${planId}`} className="px-4 py-3 text-center">
                          <span>{row.values?.[planId] ?? ''}</span>
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {(['streamCalendar', 'customWatermark'] as Array<keyof typeof BOOLEAN_ROW_VALUES>).map((rowId) => {
                  const row = comparisonMessages.booleanRows?.[rowId] ?? { label: rowId }
                  return (
                    <tr key={rowId} className="text-slate-700 dark:text-slate-200">
                      <td className="px-4 py-3 font-medium">{row.label}</td>
                      {BOOLEAN_ROW_VALUES[rowId].map((value, index) => (
                        <td key={`${rowId}-${PLAN_ORDER[index]}`} className="px-4 py-3 text-center">
                          {value ? (
                            <Check className="mx-auto h-4 w-4 text-success-500" />
                          ) : (
                            <Minus className="mx-auto h-4 w-4 text-slate-400" />
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="hover:scale-100">
          <CardHeader>
            <CardTitle>{faqMessages.title ?? tPlans('faq.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
            <p>{faqMessages.description ?? tPlans('faq.description')}</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => window.open('mailto:support@youtubestreaming.app')}>
                {faqMessages.email ?? tPlans('faq.email')}
              </Button>
              <Button variant="ghost" onClick={() => window.open('https://cal.com/', '_blank')}>
                {faqMessages.call ?? tPlans('faq.call')}
              </Button>
              <Link
                href="https://docs.google.com/forms/d/e/1FAIpQLSf-demo"
                target="_blank"
                className="text-xs font-medium text-primary-600 hover:underline"
              >
                {faqMessages.brief ?? tPlans('faq.brief')}
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
