'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { SectionContainer } from './SectionContainer'
import { PLAN_KEYS, PLAN_DETAILS } from '@/lib/plans'

export function StatsSection() {
  const t = useTranslations('landing.stats')

  const storageMax = Math.max(...PLAN_KEYS.map((key) => PLAN_DETAILS[key].storageGb))
  const streamsMax = Math.max(...PLAN_KEYS.map((key) => PLAN_DETAILS[key].streams))
  const destinationsMax = Math.max(...PLAN_KEYS.map((key) => PLAN_DETAILS[key].destinations))
  const has4K = PLAN_KEYS.some((key) => PLAN_DETAILS[key].maxResolution === '2160p')

  const stats = [
    {
      key: 'storageMax',
      value: `${storageMax}GB`,
      description: t('storageMax.description', { value: storageMax }),
      label: t('storageMax.label'),
    },
    {
      key: 'streamsMax',
      value: `${streamsMax}`,
      description: t('streamsMax.description'),
      label: t('streamsMax.label'),
    },
    {
      key: 'destinationsMax',
      value: `${destinationsMax}`,
      description: t('destinationsMax.description'),
      label: t('destinationsMax.label'),
    },
    {
      key: 'resolutionMax',
      value: has4K ? '4K60' : '1080p60',
      description: t('resolutionMax.description', { value: has4K ? '4K' : '1080p' }),
      label: t('resolutionMax.label'),
    },
  ]

  return (
    <SectionContainer>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="relative overflow-hidden rounded-2xl p-8 md:p-12"
        style={{
          background: 'linear-gradient(to bottom right, rgb(15 23 42), rgb(2 6 23))',
          boxShadow: '0 0 0 2px transparent',
          backgroundImage: 'linear-gradient(to bottom right, rgb(15 23 42), rgb(2 6 23)), linear-gradient(to right, #a855f7, #06b6d4)',
          backgroundOrigin: 'border-box',
          backgroundClip: 'padding-box, border-box',
        }}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.key}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="text-center"
            >
              <div className="text-4xl md:text-5xl font-bold mb-2 bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                {stat.value}
              </div>
              <div className="text-sm text-slate-200/80 dark:text-slate-300 mb-1">
                {stat.label}
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                {stat.description}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </SectionContainer>
  )
}
