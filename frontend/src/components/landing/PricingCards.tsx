'use client'

import { motion } from 'framer-motion'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
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
    <SectionContainer id="pricing">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <h2 className="text-3xl font-bold md:text-4xl gradient-text">{t('title')}</h2>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 md:text-base">{t('subtitle')}</p>
        </div>

        <div className="grid gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white"
          >
            <div className="flex flex-col gap-8 p-8 md:flex-row md:items-center md:justify-between md:p-10">
              <div className="max-w-2xl space-y-4">
                <div className="flex items-center space-x-3 text-sm text-slate-200/80">
                  {freePlanCopy.badge && (
                    <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
                      {freePlanCopy.badge}
                    </span>
                  )}
                  <span>{formatPrice(0)}</span>
                </div>
                <h3 className="text-3xl font-semibold">{freePlanCopy.title}</h3>
                <p className="text-sm md:text-base text-slate-200">{freePlanCopy.subtitle}</p>
                <ul className="grid gap-2 text-sm text-slate-100 md:grid-cols-2">
                  {freePlanCopy.features.map((feature) => (
                    <li key={feature} className="flex items-start">
                      <Check className="mr-2 mt-0.5 h-4 w-4 text-emerald-300" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex w-full md:w-auto">
                <Button
                  variant="secondary"
                  className="w-full bg-white text-slate-900 hover:bg-slate-100 md:w-auto"
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

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
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
              const isActive = isSelected
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
              const selectionBadge = isSelected ? t('selection.badges.selected') : null
              const buttonVariant = isSelected ? 'primary' : 'secondary'
              const buttonLabel = isSelected
                ? t('selection.button.selected', { plan: planMeta?.name ?? planKey })
                : t('selection.button.default')

              return (
                <motion.div
                  key={planKey}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.08 }}
                  whileHover={{ translateY: -6 }}
                  className="relative"
                >
                  {planMeta?.badge && (
                    <div className="absolute -top-4 left-1/2 z-10 -translate-x-1/2">
                      <div className="rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg">
                        {planMeta.badge}
                      </div>
                    </div>
                  )}

                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedPlan(planKey)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedPlan(planKey)
                      }
                    }}
                    className={cn(
                      'flex h-full flex-col rounded-3xl border border-slate-200/70 bg-white/95 p-6 shadow-sm backdrop-blur transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/40 dark:border-slate-700/60 dark:bg-slate-900/70',
                      isPopular && !isSelected ? 'border-transparent ring-2 ring-purple-500/40 shadow-lg dark:ring-cyan-400/40' : '',
                      isSelected ? 'border-purple-400 ring-2 ring-purple-400/50 shadow-lg dark:ring-cyan-400/50' : '',
                      isActive ? 'border-success-400 ring-2 ring-success-400/40 bg-success-50/40 dark:bg-success-900/20' : ''
                    )}
                  >
                    {selectionBadge ? (
                      <div className="mb-4 flex justify-start">
                        <Badge variant={isActive ? 'success' : 'secondary'}>{selectionBadge}</Badge>
                      </div>
                    ) : null}
                    <div className="mb-6 space-y-3 text-center">
                      <h3 className="text-2xl font-semibold text-slate-900 dark:text-white">{planMeta?.name}</h3>
                      {planMeta?.tagline && (
                        <p className="text-sm text-slate-500 dark:text-slate-400">{planMeta.tagline}</p>
                      )}
                      <div className="flex items-baseline justify-center">
                        <span className="bg-gradient-to-r from-purple-600 to-cyan-600 bg-clip-text text-4xl font-bold text-transparent">
                          {price}
                        </span>
                        {plan.priceUsd > 0 && (
                          <span className="ml-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                            {billingPeriod}
                          </span>
                        )}
                      </div>
                    </div>

                    <ul className="mb-8 flex-1 space-y-3">
                      {features.map((feature) => (
                        <li key={feature} className="flex items-start">
                          <Check className="mr-3 mt-0.5 h-5 w-5 text-success-500" />
                          <span className="text-sm text-slate-600 dark:text-slate-300">{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      className={cn('mt-auto w-full', isSelected ? 'shadow-glow' : '')}
                      variant={buttonVariant}
                      disabled={isActive}
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
                      {buttonLabel}
                    </Button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </motion.div>
    </SectionContainer>
  )
}
