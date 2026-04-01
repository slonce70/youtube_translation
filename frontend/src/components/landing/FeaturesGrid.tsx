'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Gauge, Radio, Shield, TvMinimal, Upload, Zap } from 'lucide-react'
import { SectionContainer } from './SectionContainer'

const features = [
  {
    key: 'streaming',
    icon: Radio,
    accent: 'bg-amber-200 text-amber-900',
    cardClass: 'md:col-span-2 bg-[linear-gradient(135deg,rgba(255,248,236,0.92),rgba(255,255,255,0.78))]',
  },
  {
    key: 'multiChannel',
    icon: TvMinimal,
    accent: 'bg-cyan-100 text-cyan-900',
    cardClass: 'bg-white/80',
  },
  {
    key: 'quota',
    icon: Gauge,
    accent: 'bg-slate-900 text-cyan-200',
    cardClass: 'bg-slate-950 text-slate-50',
  },
  {
    key: 'quality',
    icon: Zap,
    accent: 'bg-violet-100 text-violet-900',
    cardClass: 'bg-white/80',
  },
  {
    key: 'schedule',
    icon: Shield,
    accent: 'bg-emerald-100 text-emerald-900',
    cardClass: 'bg-[linear-gradient(135deg,rgba(240,253,250,0.85),rgba(255,255,255,0.78))]',
  },
  {
    key: 'uploads',
    icon: Upload,
    accent: 'bg-rose-100 text-rose-900',
    cardClass: 'bg-white/80',
  },
]

export function FeaturesGrid() {
  const t = useTranslations('landing.features')

  return (
    <SectionContainer id="features">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="space-y-10"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="landing-kicker">
              <span>{t('eyebrow')}</span>
            </div>
            <h2 className="landing-display mt-5 max-w-3xl text-4xl text-slate-950 md:text-5xl">
              <span className="landing-gradient-text">{t('title')}</span>
            </h2>
          </div>
          <div className="max-w-xl text-base leading-7 text-slate-600">
            {t('intro')}
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {features.map((feature, index) => {
            const Icon = feature.icon
            const isDark = feature.key === 'quota'

            return (
              <motion.article
                key={feature.key}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: index * 0.08 }}
                whileHover={{ y: -6 }}
                className={`landing-panel landing-noise relative overflow-hidden p-6 ${feature.cardClass} ${
                  isDark ? 'border-white/10 shadow-[0_28px_70px_-40px_rgba(8,15,29,0.9)]' : ''
                }`}
              >
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-white/35 blur-2xl" />
                <div className="relative">
                  <div className={`inline-flex rounded-2xl p-3 ${feature.accent}`}>
                    <Icon className="h-6 w-6" />
                  </div>

                  <h3 className={`mt-6 text-2xl font-semibold ${isDark ? 'text-white' : 'text-slate-950'}`}>
                    {t(`items.${feature.key}.title`)}
                  </h3>

                  <p className={`mt-4 text-sm leading-7 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                    {t(`items.${feature.key}.description`)}
                  </p>
                </div>
              </motion.article>
            )
          })}
        </div>
      </motion.div>
    </SectionContainer>
  )
}
