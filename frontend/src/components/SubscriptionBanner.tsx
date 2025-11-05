'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Crown, Sparkles, TrendingUp, X } from 'lucide-react'

import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'

interface SubscriptionBannerProps {
  tier: 'free' | 'pro' | 'business' | 'enterprise'
  expiresAt?: string
  onUpgrade?: () => void
}

const tierVisuals = {
  free: {
    color: 'from-slate-500 to-slate-600',
    icon: Sparkles,
    showUpgrade: true,
  },
  pro: {
    color: 'from-primary-500 to-purple-600',
    icon: Crown,
    showUpgrade: true,
  },
  business: {
    color: 'from-accent-500 to-cyan-600',
    icon: TrendingUp,
    showUpgrade: false,
  },
  enterprise: {
    color: 'from-amber-500 to-orange-600',
    icon: Crown,
    showUpgrade: false,
  },
} as const

const BANNER_STORAGE_KEY = 'subscription-banner-dismissed'
const BANNER_TTL_MS = 24 * 60 * 60 * 1000

const getStorageKey = (tier: string) => `${BANNER_STORAGE_KEY}:${tier}`

export function SubscriptionBanner({ tier, expiresAt, onUpgrade }: SubscriptionBannerProps) {
  const visuals = tierVisuals[tier]
  const Icon = visuals.icon
  const banner = useTranslations('dashboard.subscriptionBanner')
  const locale = useLocale()
  const [visible, setVisible] = useState(() => !visuals.showUpgrade)

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
    if (!visuals.showUpgrade) {
      setVisible(true)
      return
    }

    if (typeof window === 'undefined') {
      return
    }

    const raw = window.localStorage.getItem(getStorageKey(tier))

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { timestamp?: number }
        if (parsed?.timestamp && Date.now() - parsed.timestamp < BANNER_TTL_MS) {
          setVisible(false)
          return
        }
      } catch {
        // ignore malformed storage contents and show banner
      }
    }

    setVisible(true)
  }, [tier, visuals.showUpgrade])

  const persistDismissal = () => {
    if (!visuals.showUpgrade || typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(getStorageKey(tier), JSON.stringify({ timestamp: Date.now() }))
  }

  const handleDismiss = () => {
    persistDismissal()
    setVisible(false)
  }

  const handleUpgradeClick = () => {
    persistDismissal()
    onUpgrade?.()
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
                      <div
                        className={`w-2 h-2 rounded-full ${
                          tier === 'business'
                            ? 'bg-accent-500'
                            : tier === 'enterprise'
                              ? 'bg-amber-500'
                              : 'bg-primary-500'
                        }`}
                      />
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
                    <Button variant="ghost" size="sm">
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

