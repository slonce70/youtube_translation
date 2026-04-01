'use client'

import { motion } from 'framer-motion'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { SectionContainer } from './SectionContainer'
import { PLAN_KEYS, PLAN_DETAILS, type PlanKey } from '@/lib/plans'
import { cn } from '@/lib/utils'

const POPULAR_PLANS: PlanKey[] = ['fhd_flow']

type Props = {
  onStartStreaming?: () => void | Promise<void>
}

export function PricingCards({ onStartStreaming }: Props) {
  const t = useTranslations('landing.pricing')
  const billingPeriod = t('billingPeriod')
  const freePlanCopy = t.raw('freeCard') as {
    badge?: string
    title: string
    subtitle: string
    button: string
    features: string[]
  }
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>(POPULAR_PLANS[0])

  const formatPrice = (price: number) => {
    if (price === 0) {
      return '$0'
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(price)
  }

  const paidPlans = PLAN_KEYS.filter((planKey) => planKey !== 'free')

  return (
    <SectionContainer id="pricing" className="pb-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="space-y-8"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="landing-kicker">
              <span>{t('eyebrow')}</span>
            </div>
            <h2 className="landing-display mt-5 text-4xl text-slate-950 md:text-5xl">
              <span className="landing-gradient-text">{t('title')}</span>
            </h2>
          </div>
          <p className="max-w-xl text-base leading-7 text-slate-600">{t('subtitle')}</p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="landing-section-dark landing-noise overflow-hidden px-6 py-7 sm:px-8 md:px-10 md:py-9"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(245,158,11,0.14),transparent_24%)]" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-3 text-sm text-slate-300">
                {freePlanCopy.badge && (
                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-slate-200">
                    {freePlanCopy.badge}
                  </span>
                )}
                <span>{formatPrice(0)}</span>
              </div>
              <h3 className="landing-display mt-5 text-4xl text-white">{freePlanCopy.title}</h3>
              <p className="mt-4 max-w-xl text-base leading-7 text-slate-300">{freePlanCopy.subtitle}</p>
              <ul className="mt-6 grid gap-3 text-sm text-slate-200 md:grid-cols-2">
                {freePlanCopy.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 text-emerald-300" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="w-full max-w-sm rounded-[1.75rem] border border-white/10 bg-white/5 p-5 backdrop-blur lg:p-6">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{t('ctaLabel')}</div>
              <div className="mt-4 text-3xl font-semibold text-white">{freePlanCopy.button}</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {t('freeCard.note')}
              </p>
              <Button
                variant="secondary"
                className="mt-6 w-full rounded-2xl border border-white/10 bg-white text-slate-950 hover:bg-slate-100"
                onClick={() => {
                  if (onStartStreaming) {
                    void onStartStreaming()
                  }
                }}
              >
                {freePlanCopy.button}
              </Button>
            </div>
          </div>
        </motion.div>

        <div className="grid gap-5 xl:grid-cols-3">
          {paidPlans.map((planKey, index) => {
            const plan = PLAN_DETAILS[planKey]
            const price = formatPrice(plan.priceUsd)
            const planMeta = t.raw(`planLabels.${planKey}`) as {
              name: string
              tagline?: string
              badge?: string
            }
            const resolutionLabel = plan.maxResolution === '2160p' ? '4K' : 'Full HD'
            const isSelected = selectedPlan === planKey
            const features: string[] = [
              t('featureLabels.storage', { value: plan.storageGb }),
              t('featureLabels.streams', { value: plan.streams }),
              t('featureLabels.destinations', { value: plan.destinations }),
              t('featureLabels.resolution', { resolution: resolutionLabel, fps: plan.maxFps }),
              plan.dailyLimitHours === null
                ? t('featureLabels.noDailyLimit')
                : t('featureLabels.dailyLimit', { hours: plan.dailyLimitHours }),
              t('featureLabels.support', { value: t(`supportLevels.${plan.supportLevel}`) }),
            ]

            if (plan.branding) {
              features.push(t('featureLabels.branding'))
            }
            if (plan.automation) {
              features.push(t('featureLabels.automation'))
            }
            if (plan.dedicatedManager) {
              features.push(t('featureLabels.manager'))
            }

            const isPopular = POPULAR_PLANS.includes(planKey)

            return (
              <motion.article
                key={planKey}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: index * 0.06 }}
                className={cn(
                  'landing-panel landing-noise relative flex h-full flex-col overflow-hidden p-6',
                  isSelected
                    ? 'border-slate-950/10 bg-slate-950 text-white shadow-[0_30px_80px_-42px_rgba(8,15,29,0.92)]'
                    : 'bg-white/78'
                )}
              >
                <div className="absolute right-0 top-0 h-32 w-32 translate-x-8 -translate-y-8 rounded-full bg-gradient-to-br from-amber-300/40 to-cyan-300/20 blur-3xl" />
                <div className="relative flex h-full flex-col">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      {planMeta?.badge ? (
                        <div className="mb-4">
                          <Badge variant={isSelected ? 'success' : 'secondary'}>{planMeta.badge}</Badge>
                        </div>
                      ) : null}
                      <h3 className={cn('landing-display text-4xl', isSelected ? 'text-white' : 'text-slate-950')}>
                        {planMeta?.name}
                      </h3>
                      {planMeta?.tagline && (
                        <p className={cn('mt-3 text-sm leading-6', isSelected ? 'text-slate-300' : 'text-slate-600')}>
                          {planMeta.tagline}
                        </p>
                      )}
                    </div>
                    {isPopular && !planMeta?.badge ? <Badge variant="secondary">{t('popularBadge')}</Badge> : null}
                  </div>

                  <div className="mt-8 flex items-end gap-2">
                    <span className={cn('text-5xl font-semibold', isSelected ? 'text-white' : 'landing-gradient-text')}>
                      {price}
                    </span>
                    <span className={cn('pb-2 text-sm', isSelected ? 'text-slate-300' : 'text-slate-500')}>
                      {billingPeriod}
                    </span>
                  </div>

                  <div className={cn('mt-6 rounded-[1.5rem] border p-4', isSelected ? 'border-white/10 bg-white/5' : 'border-slate-200/70 bg-white/70')}>
                    <div className={cn('text-xs uppercase tracking-[0.22em]', isSelected ? 'text-slate-400' : 'text-slate-500')}>
                      {t('selection.badges.selected')}
                    </div>
                    <div className={cn('mt-3 text-sm leading-6', isSelected ? 'text-slate-300' : 'text-slate-600')}>
                      {t('selectedSummary', {
                        resolution: resolutionLabel,
                        streams: plan.streams,
                        destinations: plan.destinations,
                      })}
                    </div>
                  </div>

                  <ul className="mt-6 flex-1 space-y-3">
                    {features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <Check className={cn('mt-0.5 h-5 w-5', isSelected ? 'text-emerald-300' : 'text-emerald-600')} />
                        <span className={cn('text-sm leading-6', isSelected ? 'text-slate-200' : 'text-slate-700')}>
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8 flex gap-3">
                    <Button
                      variant={isSelected ? 'secondary' : 'primary'}
                      className={cn(
                        'w-full rounded-2xl',
                        isSelected
                          ? 'border border-white/10 bg-white text-slate-950 hover:bg-slate-100'
                          : 'bg-slate-950 text-white hover:bg-slate-900'
                      )}
                      onClick={() => {
                        if (!isSelected) {
                          setSelectedPlan(planKey)
                          return
                        }
                        if (onStartStreaming) {
                          void onStartStreaming()
                        }
                      }}
                    >
                      {isSelected ? t('selection.button.selected', { plan: planMeta?.name ?? planKey }) : t('selection.button.default')}
                      {isSelected ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
                    </Button>
                  </div>
                </div>
              </motion.article>
            )
          })}
        </div>
      </motion.div>
    </SectionContainer>
  )
}
