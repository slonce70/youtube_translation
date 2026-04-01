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
    <SectionContainer className="pt-6 md:pt-10">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="landing-section-dark landing-noise overflow-hidden px-6 py-6 sm:px-8 md:py-8"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,rgba(245,158,11,0.14),transparent_22%),radial-gradient(circle_at_right,rgba(34,211,238,0.16),transparent_26%)]" />
        <div className="relative grid gap-4 md:grid-cols-4">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.key}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: index * 0.08 }}
              className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5"
            >
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{stat.label}</div>
              <div className="mt-4 landing-display text-4xl text-white">{stat.value}</div>
              <div className="mt-3 text-sm leading-6 text-slate-300">{stat.description}</div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </SectionContainer>
  )
}
