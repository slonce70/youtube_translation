'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { ArrowRight, CheckCircle2, Radio, ShieldCheck, Sparkles, Waves } from 'lucide-react'
import { Button } from '../ui/Button'
import { PLAN_KEYS, PLAN_DETAILS } from '@/lib/plans'

type Props = {
  onStartStreaming?: () => void | Promise<void>
}

export function HeroSection({ onStartStreaming }: Props) {
  const t = useTranslations('landing.hero')
  const statsT = useTranslations('landing.stats')

  const storageMax = Math.max(...PLAN_KEYS.map((key) => PLAN_DETAILS[key].storageGb))
  const streamsMax = Math.max(...PLAN_KEYS.map((key) => PLAN_DETAILS[key].streams))
  const destinationsMax = Math.max(...PLAN_KEYS.map((key) => PLAN_DETAILS[key].destinations))

  const metrics = [
    {
      label: statsT('storageMax.label'),
      value: `${storageMax} GB`,
      tone: 'from-amber-200/80 via-orange-100 to-white',
    },
    {
      label: statsT('streamsMax.label'),
      value: `${streamsMax} x 24/7`,
      tone: 'from-cyan-200/70 via-teal-100 to-white',
    },
    {
      label: statsT('destinationsMax.label'),
      value: `${destinationsMax}`,
      tone: 'from-violet-200/70 via-fuchsia-100 to-white',
    },
  ]

  const operationalNotes = [
    t('trustIndicator').split(' • ')[0],
    statsT('resolutionMax.label'),
    statsT('streamsMax.label'),
  ]

  return (
    <section className="relative overflow-hidden px-4 pb-12 pt-8 sm:px-6 lg:px-8 lg:pb-16 lg:pt-10">
      <div className="mx-auto max-w-7xl">
        <div className="landing-section-light landing-noise overflow-hidden px-6 py-8 sm:px-8 lg:px-10 lg:py-12">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />
          <div className="absolute -left-12 top-12 h-48 w-48 rounded-full bg-amber-300/25 blur-3xl" />
          <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-violet-300/15 blur-3xl" />

          <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)] lg:items-center">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65 }}
              className="max-w-2xl"
            >
              <div className="landing-kicker">
                <Sparkles className="h-4 w-4 text-amber-600" />
                <span>{t('badge')}</span>
              </div>

              <div className="mt-7 space-y-6">
                <h1 className="landing-display max-w-4xl text-5xl leading-[0.94] text-slate-950 sm:text-6xl lg:text-7xl">
                  {t('title')
                    .split(' ')
                    .map((part, index, parts) => {
                      const isAccent = index >= parts.length - 2
                      return (
                        <span
                          key={`${part}-${index}`}
                          className={isAccent ? 'landing-gradient-text' : undefined}
                        >
                          {part}
                          {index < parts.length - 1 ? ' ' : ''}
                        </span>
                      )
                    })}
                </h1>

                <p className="max-w-xl text-lg leading-8 text-slate-600 sm:text-xl">
                  {t('subtitle')}
                </p>
              </div>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <Button
                  size="lg"
                  className="rounded-2xl border border-slate-950/5 bg-slate-950 px-7 py-4 text-base text-white shadow-[0_22px_45px_-20px_rgba(15,23,42,0.8)] transition duration-300 hover:-translate-y-0.5 hover:bg-slate-900 hover:shadow-[0_28px_55px_-22px_rgba(15,23,42,0.86)]"
                  onClick={() => {
                    if (onStartStreaming) {
                      void onStartStreaming()
                    }
                  }}
                >
                  {t('primaryCTA')}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  className="rounded-2xl border border-slate-300/80 bg-white/70 px-7 py-4 text-base text-slate-800 shadow-[0_18px_36px_-26px_rgba(15,23,42,0.48)] hover:border-slate-400 hover:bg-white"
                  onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  {t('secondaryCTA')}
                </Button>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {metrics.map((metric, index) => (
                  <motion.div
                    key={metric.label}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.15 + index * 0.08 }}
                    className={`rounded-[1.5rem] border border-white/80 bg-gradient-to-br ${metric.tone} p-4 shadow-[0_20px_36px_-24px_rgba(15,23,42,0.36)]`}
                  >
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{metric.label}</div>
                    <div className="mt-3 text-2xl font-semibold text-slate-950">{metric.value}</div>
                  </motion.div>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                {operationalNotes.map((note) => (
                  <div key={note} className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>{note}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 28 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.75, delay: 0.1 }}
              className="relative"
            >
              <div className="landing-panel-dark landing-noise relative overflow-hidden px-5 py-5 text-slate-50 sm:px-6 sm:py-6">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(251,191,36,0.16),transparent_28%)]" />

                <div className="relative">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="landing-kicker-dark">
                        <Radio className="h-4 w-4 text-cyan-300" />
                        <span>{t('panel.kicker')}</span>
                      </div>
                      <h2 className="mt-4 landing-display text-3xl text-white sm:text-4xl">
                        {t('panel.title')}
                      </h2>
                    </div>

                    <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
                      {t('panel.status')}
                    </div>
                  </div>

                  <div className="mt-8 grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
                    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 backdrop-blur">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs uppercase tracking-[0.24em] text-slate-400">
                            {t('panel.playlistLabel')}
                          </div>
                          <div className="mt-2 text-xl font-semibold text-white">
                            {t('panel.playlistTitle')}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-200">
                          <Waves className="h-5 w-5" />
                        </div>
                      </div>

                      <div className="mt-6 space-y-3">
                        {[
                          ['00:00 - 08:00', t('panel.playlistItems.overnight')],
                          ['08:00 - 18:00', t('panel.playlistItems.day')],
                          ['18:00 - 00:00', t('panel.playlistItems.evening')],
                        ].map(([time, label], index) => (
                          <motion.div
                            key={time}
                            initial={{ opacity: 0, x: -12 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.4, delay: 0.35 + index * 0.08 }}
                            className="flex items-center justify-between rounded-2xl border border-white/8 bg-slate-900/55 px-4 py-3"
                          >
                            <div>
                              <div className="text-sm font-medium text-white">{time}</div>
                              <div className="mt-1 text-sm text-slate-300">{label}</div>
                            </div>
                            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.6)]" />
                          </motion.div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 backdrop-blur">
                        <div className="flex items-center justify-between">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                            {t('panel.healthLabel')}
                          </div>
                          <ShieldCheck className="h-5 w-5 text-amber-300" />
                        </div>
                        <div className="mt-4 text-3xl font-semibold text-white">99.98%</div>
                        <p className="mt-2 text-sm leading-6 text-slate-300">
                          {t('panel.healthDescription')}
                        </p>
                      </div>

                      <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 backdrop-blur">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          {t('panel.channelsLabel')}
                        </div>
                        <div className="mt-4 space-y-3">
                          {[
                            [t('panel.channels.music.name'), t('panel.channels.music.state')],
                            [t('panel.channels.podcast.name'), t('panel.channels.podcast.state')],
                            [t('panel.channels.live.name'), t('panel.channels.live.state')],
                          ].map(([name, state]) => (
                            <div key={name} className="flex items-center justify-between text-sm">
                              <span className="text-slate-200">{name}</span>
                              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">
                                {state}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}
