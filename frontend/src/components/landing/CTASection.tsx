'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { ArrowRight, CheckCircle, Database, ShieldCheck } from 'lucide-react'
import { Button } from '../ui/Button'

type Props = {
  onStartStreaming?: () => void | Promise<void>
}

export function CTASection({ onStartStreaming }: Props) {
  const t = useTranslations('landing.cta')

  const trustIndicators = [
    { key: 'noCard', icon: CheckCircle },
    { key: 'freeStorage', icon: Database },
    { key: 'cancelAnytime', icon: ShieldCheck },
  ]

  return (
    <section className="px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="landing-section-dark landing-noise overflow-hidden px-6 py-10 sm:px-8 md:px-10 md:py-12"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.18),transparent_28%)]" />
          <div className="relative grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="max-w-2xl">
              <div className="landing-kicker-dark">
                <span>{t('eyebrow')}</span>
              </div>
              <h2 className="landing-display mt-6 text-4xl text-white md:text-6xl">
                {t('title')}
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">{t('subtitle')}</p>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{t('panelLabel')}</div>
              <div className="mt-4 text-2xl font-semibold text-white">
                {t('note')}
              </div>
              <Button
                size="lg"
                className="mt-6 w-full rounded-2xl border border-white/10 bg-white px-7 py-4 text-base text-slate-950 shadow-[0_22px_44px_-24px_rgba(255,255,255,0.24)] hover:bg-slate-100"
                onClick={() => {
                  if (onStartStreaming) {
                    void onStartStreaming()
                  }
                }}
              >
                {t('button')}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>

              <div className="mt-6 space-y-3">
                {trustIndicators.map((indicator) => {
                  const Icon = indicator.icon
                  return (
                    <div key={indicator.key} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                      <Icon className="mt-0.5 h-5 w-5 text-cyan-300" />
                      <span className="text-sm leading-6 text-slate-200">{t(`trustIndicators.${indicator.key}`)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
