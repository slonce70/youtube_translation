'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Crown, Sparkles, TrendingUp, Rocket, X } from 'lucide-react'

import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import type { SubscriptionTierKey } from '@/lib/types'

interface SubscriptionBannerProps {
  tier: SubscriptionTierKey
  expiresAt?: string
  onUpgrade?: () => void
}

const tierVisuals: Record<SubscriptionTierKey, { color: string; icon: typeof Sparkles; showUpgrade: boolean }> = {
  free: {
    color: 'from-slate-500 to-slate-600',
    icon: Sparkles,
    showUpgrade: true,
  },
  fhd_start: {
    color: 'from-primary-400 to-primary-500',
    icon: TrendingUp,
    showUpgrade: true,
  },
  fhd_flow: {
    color: 'from-primary-500 to-purple-600',
    icon: TrendingUp,
    showUpgrade: true,
  },
  fhd_boost: {
    color: 'from-primary-600 to-fuchsia-600',
    icon: Crown,
    showUpgrade: true,
  },
  uhd_start: {
    color: 'from-amber-500 to-orange-500',
    icon: Rocket,
    showUpgrade: true,
  },
  uhd_flow: {
    color: 'from-amber-600 to-orange-600',
    icon: Rocket,
    showUpgrade: true,
  },
  uhd_boost: {
    color: 'from-amber-700 to-rose-600',
    icon: Crown,
    showUpgrade: false,
  },
}

const tierDotColor: Record<SubscriptionTierKey, string> = {
  free: 'bg-slate-500',
  fhd_start: 'bg-primary-400',
  fhd_flow: 'bg-primary-500',
  fhd_boost: 'bg-primary-600',
  uhd_start: 'bg-amber-500',
  uhd_flow: 'bg-amber-600',
  uhd_boost: 'bg-rose-500',
}

const BANNER_STORAGE_KEY = 'subscription-banner-dismissed'
const BANNER_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REMIND_LATER_TTL_MS = 24 * 60 * 60 * 1000

const getStorageKey = (tier: string) => `${BANNER_STORAGE_KEY}:${tier}`

const shouldDisplayBanner = (tier: SubscriptionTierKey) => {
  if (typeof window === 'undefined') {
    return false
  }

  const raw = window.localStorage.getItem(getStorageKey(tier))

  if (!raw) {
    return true
  }

  try {
    const parsed = JSON.parse(raw) as { timestamp?: number; ttlMs?: number }
    if (!parsed?.timestamp) {
      return true
    }

    const ttlMs = typeof parsed.ttlMs === 'number' && parsed.ttlMs > 0 ? parsed.ttlMs : BANNER_TTL_MS
    return Date.now() - parsed.timestamp > ttlMs
  } catch {
    return true
  }
}

export function SubscriptionBanner({ tier, expiresAt, onUpgrade }: SubscriptionBannerProps) {
  const visuals = tierVisuals[tier]
  const Icon = visuals.icon
  const banner = useTranslations('dashboard.subscriptionBanner')
  const locale = useLocale()
  const [visible, setVisible] = useState(() => shouldDisplayBanner(tier))

  const translations = useMemo(() => {
    const features = banner.raw(`tiers.${tier}.features`) as string[] | undefined

    return {
      name: banner(`tiers.${tier}.name`),
      message: banner(`tiers.${tier}.message`),
      cta: banner(`tiers.${tier}.cta`),
      primaryAction: visuals.showUpgrade ? banner(`tiers.${tier}.primaryAction`) : undefined,
      features: features ?? [],
    }
  }, [banner, tier, visuals.showUpgrade])

  useEffect(() => {
    setVisible(shouldDisplayBanner(tier))
  }, [tier])

  const persistDismissal = (ttlMs: number = BANNER_TTL_MS) => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      getStorageKey(tier),
      JSON.stringify({ timestamp: Date.now(), ttlMs }),
    )
  }

  const handleDismiss = () => {
    persistDismissal()
    setVisible(false)
  }

  const handleUpgradeClick = () => {
    persistDismissal()
    onUpgrade?.()
  }

  const handleRemindLater = () => {
    persistDismissal(REMIND_LATER_TTL_MS)
    setVisible(false)
  }

  if (!visible) {
    return null
  }

  const expiryLabel = expiresAt
    ? banner('expires', {
        date: new Date(expiresAt).toLocaleDateString(locale, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      })
    : null

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="relative overflow-hidden border-2">
        <div className={`absolute inset-0 bg-gradient-to-r ${visuals.color} opacity-5`} />

        <div className="relative p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-4 flex-1">
              <div className={`p-3 rounded-xl bg-gradient-to-br ${visuals.color} shadow-lg`}>
                <Icon className="w-6 h-6 text-white" />
              </div>

              <div className="flex-1">
                <div className="flex items-center space-x-3 mb-2">
                  <h3 className="text-lg font-bold">{translations.message}</h3>
                  <Badge
                    variant="secondary"
                    className={`bg-gradient-to-r ${visuals.color} text-white border-0`}
                  >
                    {translations.name}
                  </Badge>
                </div>

                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                  {translations.cta}
                </p>

                {expiryLabel && (
                  <p className="text-xs text-slate-500 dark:text-slate-500 mb-4">{expiryLabel}</p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  {translations.features.map((feature, index) => (
                    <div key={index} className="flex items-center space-x-2 text-sm">
                      <div className={`w-2 h-2 rounded-full ${tierDotColor[tier] ?? 'bg-primary-500'}`} />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                {visuals.showUpgrade && translations.primaryAction && (
                  <div className="flex items-center space-x-3">
                    <Button
                      onClick={handleUpgradeClick}
                      className={`bg-gradient-to-r ${visuals.color} text-white border-0`}
                    >
                      <TrendingUp className="w-4 h-4 mr-2" />
                      {translations.primaryAction}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleRemindLater}>
                      {banner('secondaryAction')}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleDismiss}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={banner('dismiss')}
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
