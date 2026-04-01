'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { BarChart3, ListPlus, Play, Upload } from 'lucide-react'
import { SectionContainer } from './SectionContainer'

const steps = [
  { key: 'upload', icon: Upload, accent: 'from-amber-300/20 to-orange-400/10' },
  { key: 'playlist', icon: ListPlus, accent: 'from-cyan-300/20 to-teal-400/10' },
  { key: 'stream', icon: Play, accent: 'from-violet-300/20 to-fuchsia-400/10' },
  { key: 'monitor', icon: BarChart3, accent: 'from-emerald-300/20 to-teal-300/10' },
]

export function HowItWorks() {
  const t = useTranslations('landing.howItWorks')

  return (
    <SectionContainer id="how-it-works">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="landing-section-dark landing-noise px-6 py-8 sm:px-8 md:px-10 md:py-10"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/50 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.16),transparent_28%)]" />

        <div className="relative">
          <div className="max-w-3xl">
            <div className="landing-kicker-dark">
              <span>{t('eyebrow')}</span>
            </div>
            <h2 className="landing-display mt-5 text-4xl text-white md:text-5xl">
              {t('title')}
            </h2>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-4">
            {steps.map((step, index) => {
              const Icon = step.icon
              return (
                <motion.div
                  key={step.key}
                  initial={{ opacity: 0, y: 26 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="relative"
                >
                  <div className={`absolute left-6 right-6 top-8 hidden h-px bg-gradient-to-r ${step.accent} lg:block`} />
                  <div className="relative h-full rounded-[1.75rem] border border-white/10 bg-white/5 p-6 backdrop-blur">
                    <div className="flex items-center justify-between">
                      <div className="landing-display text-5xl text-white/16">{String(index + 1).padStart(2, '0')}</div>
                      <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                        <Icon className="h-6 w-6 text-white" />
                      </div>
                    </div>
                    <h3 className="mt-10 text-2xl font-semibold text-white">{t(`steps.${step.key}.title`)}</h3>
                    <p className="mt-4 text-sm leading-7 text-slate-300">{t(`steps.${step.key}.description`)}</p>
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
