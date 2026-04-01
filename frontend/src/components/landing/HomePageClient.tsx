'use client'

import { useCallback, useMemo, useRef, type PointerEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  AudioLines,
  CheckCircle2,
  CloudUpload,
  Gauge,
  Layers3,
  PlayCircle,
  Radio,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { PLAN_DETAILS, PLAN_KEYS, type PlanKey } from '@/lib/plans'
import { Button } from '../ui/Button'
import { LandingNavBar } from './LandingNavBar'
import { Footer } from './Footer'
import { ImmersiveBackground } from './ImmersiveBackground'

type FeatureCard = {
  key: string
  icon: LucideIcon
  accent: string
  title: string
  description: string
}

type StepCard = {
  key: string
  icon: LucideIcon
  title: string
  description: string
}

type BenefitCard = {
  key: string
  icon: LucideIcon
  title: string
  description: string
}

export function HomePageClient() {
  const router = useRouter()
  const heroT = useTranslations('landing.hero')
  const navT = useTranslations('landing.nav')
  const featuresT = useTranslations('landing.features')
  const howT = useTranslations('landing.howItWorks')
  const statsT = useTranslations('landing.stats')
  const pricingT = useTranslations('landing.pricing')
  const benefitsT = useTranslations('landing.benefits')
  const ctaT = useTranslations('landing.cta')

  const heroStageRef = useRef<HTMLDivElement | null>(null)

  const handleStartStreaming = useCallback(() => {
    router.push('/login')
  }, [router])

  const metrics = useMemo(() => {
    const storageMax = Math.max(...PLAN_KEYS.map((key) => PLAN_DETAILS[key].storageGb))
    const streamsMax = Math.max(...PLAN_KEYS.map((key) => PLAN_DETAILS[key].streams))
    const destinationsMax = Math.max(...PLAN_KEYS.map((key) => PLAN_DETAILS[key].destinations))

    return [
      {
        label: statsT('storageMax.label'),
        value: `${storageMax} GB`,
        description: statsT('storageMax.description', { value: storageMax }),
      },
      {
        label: statsT('streamsMax.label'),
        value: `${streamsMax}x 24/7`,
        description: statsT('streamsMax.description'),
      },
      {
        label: statsT('destinationsMax.label'),
        value: `${destinationsMax}`,
        description: statsT('destinationsMax.description'),
      },
      {
        label: statsT('resolutionMax.label'),
        value: '4K60',
        description: statsT('resolutionMax.description', { value: '2160p' }),
      },
    ]
  }, [statsT])

  const featureCards = useMemo<FeatureCard[]>(
    () => [
      {
        key: 'streaming',
        icon: Radio,
        accent: 'from-[#ff4a62]/30 to-[#ff9e7a]/10',
        title: featuresT('items.streaming.title'),
        description: featuresT('items.streaming.description'),
      },
      {
        key: 'multiChannel',
        icon: Layers3,
        accent: 'from-[#66e6ff]/28 to-[#7b8cff]/12',
        title: featuresT('items.multiChannel.title'),
        description: featuresT('items.multiChannel.description'),
      },
      {
        key: 'quality',
        icon: ShieldCheck,
        accent: 'from-[#8fb3ff]/24 to-[#66e6ff]/10',
        title: featuresT('items.quality.title'),
        description: featuresT('items.quality.description'),
      },
      {
        key: 'schedule',
        icon: Workflow,
        accent: 'from-[#73f1c5]/24 to-[#66e6ff]/12',
        title: featuresT('items.schedule.title'),
        description: featuresT('items.schedule.description'),
      },
      {
        key: 'uploads',
        icon: CloudUpload,
        accent: 'from-[#ffd06e]/26 to-[#ff4a62]/8',
        title: featuresT('items.uploads.title'),
        description: featuresT('items.uploads.description'),
      },
      {
        key: 'quota',
        icon: Gauge,
        accent: 'from-[#a18fff]/22 to-[#66e6ff]/10',
        title: featuresT('items.quota.title'),
        description: featuresT('items.quota.description'),
      },
    ],
    [featuresT]
  )

  const steps = useMemo<StepCard[]>(
    () => [
      {
        key: 'upload',
        icon: CloudUpload,
        title: howT('steps.upload.title'),
        description: howT('steps.upload.description'),
      },
      {
        key: 'playlist',
        icon: PlayCircle,
        title: howT('steps.playlist.title'),
        description: howT('steps.playlist.description'),
      },
      {
        key: 'stream',
        icon: Radio,
        title: howT('steps.stream.title'),
        description: howT('steps.stream.description'),
      },
      {
        key: 'monitor',
        icon: RefreshCcw,
        title: howT('steps.monitor.title'),
        description: howT('steps.monitor.description'),
      },
    ],
    [howT]
  )

  const highlightedPlans = useMemo<PlanKey[]>(() => ['free', 'fhd_flow', 'uhd_boost'], [])

  const benefitCards = useMemo<BenefitCard[]>(
    () => [
      {
        key: 'quality',
        icon: CheckCircle2,
        title: benefitsT('items.quality.title'),
        description: benefitsT('items.quality.description'),
      },
      {
        key: 'secure',
        icon: ShieldCheck,
        title: benefitsT('items.secure.title'),
        description: benefitsT('items.secure.description'),
      },
      {
        key: 'simple',
        icon: Workflow,
        title: benefitsT('items.simple.title'),
        description: benefitsT('items.simple.description'),
      },
      {
        key: 'support',
        icon: AudioLines,
        title: benefitsT('items.support.title'),
        description: benefitsT('items.support.description'),
      },
    ],
    [benefitsT]
  )

  const stageCopy = useMemo(
    () => ({
      badge: heroT('scene.badge'),
      routingLabel: heroT('scene.routingLabel'),
      routingValue: heroT('scene.routingValue'),
      statusLive: heroT('scene.statusLive'),
      mainDestinationLabel: heroT('scene.mainDestinationLabel'),
      mainDestinationValue: heroT('scene.mainDestinationValue'),
      statusHealthy: heroT('scene.statusHealthy'),
      fallbackLabel: heroT('scene.fallbackLabel'),
      fallbackValue: heroT('scene.fallbackValue'),
      restartLabel: heroT('scene.restartLabel'),
      restartValue: heroT('scene.restartValue'),
    }),
    [heroT]
  )

  const titleParts = useMemo(() => {
    const parts = heroT('title').trim().split(/\s+/)
    const accentStart = Math.max(parts.length - 2, 0)
    return {
      lead: parts.slice(0, accentStart).join(' '),
      accent: parts.slice(accentStart).join(' '),
    }
  }, [heroT])

  const handleHeroPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const element = heroStageRef.current
    if (!element) {
      return
    }

    const rect = element.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    element.style.setProperty('--stream-v3-stage-rotate-x', `${y * -7}deg`)
    element.style.setProperty('--stream-v3-stage-rotate-y', `${x * 10}deg`)
    element.style.setProperty('--stream-v3-stage-shift-x', `${x * 14}px`)
    element.style.setProperty('--stream-v3-stage-shift-y', `${y * 12}px`)
  }, [])

  const resetHeroPointer = useCallback(() => {
    const element = heroStageRef.current
    if (!element) {
      return
    }
    element.style.setProperty('--stream-v3-stage-rotate-x', '0deg')
    element.style.setProperty('--stream-v3-stage-rotate-y', '0deg')
    element.style.setProperty('--stream-v3-stage-shift-x', '0px')
    element.style.setProperty('--stream-v3-stage-shift-y', '0px')
  }, [])

  return (
    <div className="stream-v3-shell min-h-screen">
      <ImmersiveBackground />
      <LandingNavBar onStartStreaming={handleStartStreaming} />

      <main className="relative z-10">
        <section className="px-4 pb-8 pt-6 sm:px-6 lg:px-8">
          <div className="stream-v3-container">
            <div className="stream-v3-hero-grid">
              <div className="max-w-2xl xl:max-w-3xl">
                <div className="stream-v3-kicker">
                  <Sparkles className="h-4 w-4 text-[#ffd06e]" />
                  <span>{heroT('badge')}</span>
                </div>

                <div className="mt-7 space-y-6">
                  <h1 className="stream-v3-display max-w-4xl text-5xl leading-[0.96] text-white sm:text-6xl xl:text-[5.4rem]">
                    <span>{titleParts.lead} </span>
                    <span className="stream-v3-title-accent stream-v3-gradient-text">{titleParts.accent}</span>
                  </h1>

                  <p className="max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                    {heroT('subtitle')}
                  </p>
                </div>

                <div className="stream-v3-hero-actions">
                  <div className="flex flex-col gap-4 sm:flex-row">
                    <Button
                      size="lg"
                      className="stream-v3-primary-btn rounded-2xl px-7 py-4 text-base"
                      onClick={() => {
                        void handleStartStreaming()
                      }}
                    >
                      {heroT('primaryCTA')}
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="lg"
                      className="stream-v3-secondary-btn rounded-2xl px-7 py-4 text-base text-white hover:text-white"
                      onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                    >
                      {heroT('secondaryCTA')}
                    </Button>
                  </div>

                  <div className="stream-v3-pill-row text-sm text-slate-300">
                    <span className="stream-v3-pill">
                      <CheckCircle2 className="h-4 w-4 text-[#73f1c5]" />
                      {heroT('trustIndicator').split(' • ')[0]}
                    </span>
                    <span className="stream-v3-pill">
                      <Layers3 className="h-4 w-4 text-[#66e6ff]" />
                      {statsT('streamsMax.label')}
                    </span>
                    <span className="stream-v3-pill">
                      <ShieldCheck className="h-4 w-4 text-[#ffd06e]" />
                      {statsT('resolutionMax.label')}
                    </span>
                  </div>
                </div>
              </div>

              <div
                ref={heroStageRef}
                className="stream-v3-stage"
                onPointerMove={handleHeroPointerMove}
                onPointerLeave={resetHeroPointer}
              >
                <div className="stream-v3-stage-glow" />
                <div className="stream-v3-stage-grid" />
                <div className="stream-v3-stage-rings">
                  <span />
                  <span />
                  <span />
                </div>

                <div className="stream-v3-stage-main">
                  <div className="stream-v3-stage-topbar">
                    <div className="stream-v3-stage-badge">{stageCopy.badge}</div>
                    <div className="stream-v3-stage-status">{stageCopy.statusLive}</div>
                  </div>

                  <div className="stream-v3-stage-header">
                    <div>
                      <div className="stream-v3-stage-label">{stageCopy.routingLabel}</div>
                      <div className="stream-v3-stage-value">{stageCopy.routingValue}</div>
                    </div>

                    <div className="stream-v3-stage-panel stream-v3-stage-health">
                      <div className="stream-v3-stage-label">{heroT('panel.healthLabel')}</div>
                      <div className="stream-v3-stage-health__value">99.98%</div>
                      <p className="stream-v3-stage-health__text">{heroT('panel.healthDescription')}</p>
                    </div>
                  </div>

                  <div className="stream-v3-stage-panel stream-v3-stage-visual">
                    <div className="stream-v3-bars" aria-hidden="true">
                      {Array.from({ length: 16 }, (_, index) => (
                        <span
                          key={index}
                          style={{
                            animationDelay: `${index * 0.12}s`,
                            height: `${34 + (index % 5) * 10}%`,
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="stream-v3-stage-bottom">
                    <div className="stream-v3-stage-panel stream-v3-route-card">
                      <div className="stream-v3-route-card__top">
                        <div>
                          <div className="stream-v3-stage-label">{stageCopy.mainDestinationLabel}</div>
                          <strong>{stageCopy.mainDestinationValue}</strong>
                        </div>
                        <span>{stageCopy.statusHealthy}</span>
                      </div>

                      <div className="stream-v3-route-card__meta">
                        <div>
                          <span className="stream-v3-stage-label">{stageCopy.fallbackLabel}</span>
                          <strong>{stageCopy.fallbackValue}</strong>
                        </div>
                        <div>
                          <span className="stream-v3-stage-label">{stageCopy.restartLabel}</span>
                          <strong>{stageCopy.restartValue}</strong>
                        </div>
                      </div>
                    </div>

                    <div className="stream-v3-stage-panel stream-v3-mini-card stream-v3-mini-card--channels">
                      <div className="stream-v3-stage-label">{heroT('panel.channelsLabel')}</div>
                      <div className="stream-v3-routing-list">
                        <span>
                          <strong>{heroT('panel.channels.music.name')}</strong>
                          <em>{heroT('panel.channels.music.state')}</em>
                        </span>
                        <span>
                          <strong>{heroT('panel.channels.podcast.name')}</strong>
                          <em>{heroT('panel.channels.podcast.state')}</em>
                        </span>
                        <span>
                          <strong>{heroT('panel.channels.live.name')}</strong>
                          <em>{heroT('panel.channels.live.state')}</em>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <article key={metric.label} className="stream-v3-metric-card">
                  <div className="stream-v3-stage-label">{metric.label}</div>
                  <div className="stream-v3-display stream-v3-metric-card__value">{metric.value}</div>
                  <div className="stream-v3-metric-card__track" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <p className="stream-v3-metric-card__meta">{metric.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="stream-v3-container stream-v3-section">
            <div className="max-w-3xl">
              <div className="stream-v3-kicker">{navT('features')}</div>
              <h2 className="stream-v3-display mt-5 text-4xl text-white md:text-5xl">
                <span className="stream-v3-gradient-text">{featuresT('title')}</span>
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">{featuresT('intro')}</p>
            </div>

            <div className="mt-10 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {featureCards.map((feature) => {
                const Icon = feature.icon
                return (
                  <article key={feature.key} className="stream-v3-feature-card">
                    <div className={`stream-v3-feature-card__glow bg-gradient-to-br ${feature.accent}`} />
                    <div className="stream-v3-feature-card__icon">
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="mt-6 text-xl font-semibold text-white">{feature.title}</h3>
                    <p className="mt-4 text-sm leading-7 text-slate-300">{feature.description}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="stream-v3-container stream-v3-section stream-v3-section--accent">
            <div className="max-w-3xl">
              <div className="stream-v3-kicker">{howT('eyebrow')}</div>
              <h2 className="stream-v3-display mt-5 text-4xl text-white md:text-5xl">{howT('title')}</h2>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {steps.map((step, index) => {
                const Icon = step.icon
                return (
                  <article key={step.key} className="stream-v3-step-card">
                    <div className="flex items-center justify-between">
                      <span className="stream-v3-step-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="stream-v3-step-icon">
                        <Icon className="h-5 w-5 text-white" />
                      </span>
                    </div>
                    <h3 className="mt-8 text-xl font-semibold text-white">{step.title}</h3>
                    <p className="mt-4 text-sm leading-7 text-slate-300">{step.description}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section id="pricing" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="stream-v3-container stream-v3-section">
            <div className="max-w-3xl">
              <div className="stream-v3-kicker">{pricingT('eyebrow')}</div>
              <h2 className="stream-v3-display mt-5 text-4xl text-white md:text-5xl">
                <span className="stream-v3-gradient-text">{pricingT('title')}</span>
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">{pricingT('subtitle')}</p>
            </div>

            <div className="mt-10 grid gap-5 xl:grid-cols-3">
              {highlightedPlans.map((planKey) => {
                const detail = PLAN_DETAILS[planKey]
                const badge =
                  planKey === 'free'
                    ? pricingT('freeCard.badge')
                    : planKey === 'fhd_flow'
                      ? pricingT('planLabels.fhd_flow.badge')
                      : planKey === 'uhd_boost'
                        ? pricingT('planLabels.uhd_boost.badge')
                        : pricingT('eyebrow')
                const isPopular = planKey === 'fhd_flow'

                return (
                  <article
                    key={planKey}
                    className={isPopular ? 'stream-v3-pricing-card stream-v3-pricing-card--featured' : 'stream-v3-pricing-card'}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="stream-v3-stage-label">
                          {badge}
                        </div>
                        <h3 className="mt-3 text-2xl font-semibold text-white">
                          {pricingT(`planLabels.${planKey}.name`)}
                        </h3>
                        <p className="mt-3 text-sm leading-6 text-slate-300">
                          {planKey === 'free'
                            ? pricingT('freeCard.subtitle')
                            : pricingT(`planLabels.${planKey}.tagline`)}
                        </p>
                      </div>
                      {isPopular ? <span className="stream-v3-pricing-badge">{pricingT('popularBadge')}</span> : null}
                    </div>

                    <div className="mt-8 flex items-end gap-2">
                      <span className="stream-v3-display text-5xl text-white">${detail.priceUsd}</span>
                      <span className="pb-2 text-sm text-slate-400">
                        {detail.priceUsd === 0 ? pricingT('freeForever') : pricingT('billingPeriod')}
                      </span>
                    </div>

                    <div className="mt-8 space-y-3 text-sm text-slate-200">
                      <div className="stream-v3-feature-line">{pricingT('featureLabels.storage', { value: detail.storageGb })}</div>
                      <div className="stream-v3-feature-line">{pricingT('featureLabels.streams', { value: detail.streams })}</div>
                      <div className="stream-v3-feature-line">
                        {pricingT('featureLabels.destinations', { value: detail.destinations })}
                      </div>
                      <div className="stream-v3-feature-line">
                        {pricingT('featureLabels.resolution', {
                          resolution: detail.maxResolution,
                          fps: detail.maxFps,
                        })}
                      </div>
                      <div className="stream-v3-feature-line">
                        {detail.dailyLimitHours === null
                          ? pricingT('featureLabels.noDailyLimit')
                          : pricingT('featureLabels.dailyLimit', { hours: detail.dailyLimitHours })}
                      </div>
                    </div>

                    <Button
                      size="lg"
                      className={isPopular ? 'stream-v3-primary-btn mt-8 w-full rounded-2xl py-3.5' : 'stream-v3-secondary-btn mt-8 w-full rounded-2xl py-3.5 text-white hover:text-white'}
                      onClick={() => {
                        void handleStartStreaming()
                      }}
                    >
                      {planKey === 'free' ? pricingT('freeCard.button') : pricingT('ctaLabel')}
                    </Button>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section id="benefits" className="px-4 py-10 sm:px-6 lg:px-8">
          <div className="stream-v3-container stream-v3-section">
            <div className="max-w-3xl">
              <div className="stream-v3-kicker">{benefitsT('eyebrow')}</div>
              <h2 className="stream-v3-display mt-5 text-4xl text-white md:text-5xl">{benefitsT('title')}</h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">{benefitsT('intro')}</p>
            </div>

            <div className="mt-10 grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
              {benefitCards.map((benefit) => {
                const Icon = benefit.icon
                return (
                  <article key={benefit.key} className="stream-v3-benefit-card">
                    <span className="stream-v3-benefit-icon">
                      <Icon className="h-5 w-5 text-white" />
                    </span>
                    <h3 className="mt-6 text-xl font-semibold text-white">{benefit.title}</h3>
                    <p className="mt-4 text-sm leading-7 text-slate-300">{benefit.description}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section className="px-4 pb-10 pt-12 sm:px-6 lg:px-8">
          <div className="stream-v3-container stream-v3-cta">
            <div className="max-w-3xl">
              <div className="stream-v3-kicker">{ctaT('eyebrow')}</div>
              <h2 className="stream-v3-display mt-6 text-4xl text-white md:text-6xl">{ctaT('title')}</h2>
              <p className="mt-5 text-lg leading-8 text-slate-300">{ctaT('subtitle')}</p>
            </div>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Button
                size="lg"
                className="stream-v3-primary-btn rounded-2xl px-7 py-4 text-base"
                onClick={() => {
                  void handleStartStreaming()
                }}
              >
                {ctaT('button')}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="stream-v3-secondary-btn rounded-2xl px-7 py-4 text-base text-white hover:text-white"
                onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
              >
                {navT('pricing')}
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer onStartStreaming={handleStartStreaming} />
    </div>
  )
}
