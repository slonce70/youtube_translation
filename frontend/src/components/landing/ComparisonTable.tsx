'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Check, X } from 'lucide-react'
import { SectionContainer } from './SectionContainer'
import { PLAN_KEYS, PLAN_DETAILS } from '@/lib/plans'

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
      >
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2 className="text-3xl md:text-4xl font-bold gradient-text mb-4">
            {t('title')}
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm md:text-base">
            {t('subtitle')}
          </p>
        </div>

        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-purple-500/10 dark:bg-purple-500/20">
                  <th className="text-left py-4 px-6 text-sm font-semibold text-slate-900 dark:text-white">
                    {t('features.storage')}
                  </th>
                  {PLAN_KEYS.map((planKey) => {
                    const planMeta = pricingT.raw(`planLabels.${planKey}`) as { name: string }
                    return (
                      <th
                        key={planKey}
                        className="text-center py-4 px-6 text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap"
                      >
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
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    className={`border-t border-slate-200 dark:border-slate-700 ${
                      index % 2 === 0 ? 'bg-slate-50/50 dark:bg-slate-800/50' : ''
                    }`}
                  >
                    <td className="py-4 px-6 text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {t(`features.${featureKey}`)}
                    </td>
                    {PLAN_KEYS.map((planKey) => {
                      const value = renderValue(planKey, featureKey)
                      return (
                        <td key={`${planKey}-${featureKey}`} className="py-4 px-6 text-center">
                          {isBooleanFeature(featureKey) ? (
                            value ? (
                              <Check className="w-5 h-5 text-success-500 mx-auto" />
                            ) : (
                              <X className="w-5 h-5 text-error-500 mx-auto" />
                            )
                          ) : (
                            <span className="text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">
                              {value}
                            </span>
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
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 space-y-1">
          <span className="block">{t('notes.dailyLimit')}</span>
          <span className="block">{t('notes.resolution')}</span>
        </p>
      </motion.div>
    </SectionContainer>
  )
}
