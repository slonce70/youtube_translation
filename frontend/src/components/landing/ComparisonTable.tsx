'use client'

import { motion } from 'framer-motion'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, X } from 'lucide-react'
import { SectionContainer } from './SectionContainer'
import { PLAN_KEYS, PLAN_DETAILS, type PlanKey } from '@/lib/plans'
import { cn } from '@/lib/utils'

type FeatureKey =
  | 'storage'
  | 'streams'
  | 'destinations'
  | 'dailyLimit'
  | 'resolution'
  | 'branding'
  | 'automation'
  | 'support'
  | 'manager'

const featureOrder: FeatureKey[] = [
  'storage',
  'streams',
  'destinations',
  'dailyLimit',
  'resolution',
  'branding',
  'automation',
  'support',
  'manager',
]

const isBooleanFeature = (key: FeatureKey) => key === 'branding' || key === 'automation' || key === 'manager'

export function ComparisonTable() {
  const t = useTranslations('landing.comparison')
  const pricingT = useTranslations('landing.pricing')
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('fhd_flow')

  const renderValue = (planKey: (typeof PLAN_KEYS)[number], featureKey: FeatureKey) => {
    const plan = PLAN_DETAILS[planKey]
    switch (featureKey) {
      case 'storage':
        return `${plan.storageGb}`
      case 'streams':
        return `${plan.streams}`
      case 'destinations':
        return `${plan.destinations}`
      case 'dailyLimit':
        return plan.dailyLimitHours === null ? '24/7' : `${plan.dailyLimitHours}h`
      case 'resolution':
        return `${plan.maxResolution} @ ${plan.maxFps}fps`
      case 'branding':
        return plan.branding
      case 'automation':
        return plan.automation
      case 'support':
        return pricingT(`supportLevels.${plan.supportLevel}`)
      case 'manager':
        return plan.dedicatedManager
      default:
        return ''
    }
  }

  return (
    <SectionContainer>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="space-y-8"
      >
        <div className="max-w-3xl">
          <div className="landing-kicker">
            <span>{t('eyebrow')}</span>
          </div>
          <h2 className="landing-display mt-5 text-4xl text-slate-950 md:text-5xl">
            <span className="landing-gradient-text">{t('title')}</span>
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">{t('subtitle')}</p>
        </div>

        <div className="hidden overflow-hidden rounded-[2rem] border border-white/70 bg-white/72 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.42)] backdrop-blur-xl lg:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-950 text-white">
                  <th className="text-left px-6 py-5 text-sm font-semibold uppercase tracking-[0.22em] text-slate-300">
                    {t('features.storage')}
                  </th>
                  {PLAN_KEYS.map((planKey) => {
                    const planMeta = pricingT.raw(`planLabels.${planKey}`) as { name: string }
                    return (
                      <th key={planKey} className="px-4 py-5 text-center text-sm font-semibold text-white whitespace-nowrap">
                        {planMeta?.name ?? planKey}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {featureOrder.map((featureKey, index) => (
                  <motion.tr
                    key={featureKey}
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    className={cn(
                      'border-t border-slate-200',
                      index % 2 === 0 ? 'bg-slate-50/70' : 'bg-white/40'
                    )}
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-slate-700">
                      {t(`features.${featureKey}`)}
                    </td>
                    {PLAN_KEYS.map((planKey) => {
                      const value = renderValue(planKey, featureKey)
                      return (
                        <td key={`${planKey}-${featureKey}`} className="px-4 py-4 text-center">
                          {isBooleanFeature(featureKey) ? (
                            value ? (
                              <Check className="mx-auto h-5 w-5 text-emerald-600" />
                            ) : (
                              <X className="mx-auto h-5 w-5 text-rose-500" />
                            )
                          ) : (
                            <span className="whitespace-nowrap text-sm text-slate-700">{value}</span>
                          )}
                        </td>
                      )
                    })}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4 lg:hidden">
          <div className="flex gap-3 overflow-x-auto pb-2">
            {PLAN_KEYS.map((planKey) => {
              const planMeta = pricingT.raw(`planLabels.${planKey}`) as { name: string }
              const isSelected = selectedPlan === planKey
              return (
                <button
                  key={planKey}
                  type="button"
                  onClick={() => setSelectedPlan(planKey)}
                  className={cn(
                    'shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition',
                    isSelected
                      ? 'border-slate-950 bg-slate-950 text-white shadow-[0_18px_36px_-24px_rgba(15,23,42,0.7)]'
                      : 'border-slate-200 bg-white/80 text-slate-700'
                  )}
                >
                  {planMeta?.name ?? planKey}
                </button>
              )
            })}
          </div>

          <div className="landing-panel overflow-hidden p-4">
            <div className="space-y-3">
              {featureOrder.map((featureKey) => {
                const value = renderValue(selectedPlan, featureKey)
                return (
                  <div
                    key={`${selectedPlan}-${featureKey}`}
                    className="flex items-center justify-between gap-4 rounded-[1.25rem] border border-slate-200/70 bg-white/75 px-4 py-3"
                  >
                    <span className="text-sm font-medium leading-6 text-slate-700">{t(`features.${featureKey}`)}</span>
                    <span className="text-right text-sm leading-6 text-slate-900">
                      {isBooleanFeature(featureKey) ? (
                        value ? (
                          <Check className="h-5 w-5 text-emerald-600" />
                        ) : (
                          <X className="h-5 w-5 text-rose-500" />
                        )
                      ) : (
                        value
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <p className="space-y-1 text-xs text-slate-500">
          <span className="block">{t('notes.dailyLimit')}</span>
          <span className="block">{t('notes.resolution')}</span>
        </p>
      </motion.div>
    </SectionContainer>
  )
}
