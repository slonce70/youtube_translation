'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Activity, Shield, Upload, Zap } from 'lucide-react'
import { SectionContainer } from './SectionContainer'

const benefits = [
  { key: 'quality', icon: Zap, accent: 'bg-amber-100 text-amber-900' },
  { key: 'secure', icon: Shield, accent: 'bg-emerald-100 text-emerald-900' },
  { key: 'simple', icon: Upload, accent: 'bg-violet-100 text-violet-900' },
  { key: 'support', icon: Activity, accent: 'bg-cyan-100 text-cyan-900' },
]

export function BenefitsSection() {
  const t = useTranslations('landing.benefits')

  return (
    <SectionContainer id="benefits" className="pt-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="landing-section-light landing-noise overflow-hidden px-6 py-8 sm:px-8 md:px-10 md:py-10"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(245,158,11,0.14),transparent_24%)]" />

        <div className="relative">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="landing-kicker">
                <span>{t('eyebrow')}</span>
              </div>
              <h2 className="landing-display mt-5 text-4xl text-slate-950 md:text-5xl">
                <span className="landing-gradient-text">{t('title')}</span>
              </h2>
            </div>
            <div className="max-w-xl text-base leading-7 text-slate-600">
              {t('intro')}
            </div>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {benefits.map((benefit, index) => {
              const Icon = benefit.icon
              return (
                <motion.article
                  key={benefit.key}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, delay: index * 0.08 }}
                  className="rounded-[1.75rem] border border-slate-200/75 bg-white/78 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.35)]"
                >
                  <div className="flex items-start gap-5">
                    <div className={`rounded-[1.25rem] p-4 ${benefit.accent}`}>
                      <Icon className="h-7 w-7" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-semibold text-slate-950">{t(`items.${benefit.key}.title`)}</h3>
                      <p className="mt-4 text-base leading-7 text-slate-600">
                        {t(`items.${benefit.key}.description`)}
                      </p>
                    </div>
                  </div>
                </motion.article>
              )
            })}
          </div>
        </div>
      </motion.div>
    </SectionContainer>
  )
}
