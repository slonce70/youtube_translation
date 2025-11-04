'use client'

import { motion } from 'framer-motion'
import { Crown, Sparkles, TrendingUp, X } from 'lucide-react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { useState } from 'react'

interface SubscriptionBannerProps {
  tier: 'free' | 'pro' | 'business' | 'enterprise'
  expiresAt?: string
  onUpgrade?: () => void
}

const tierInfo = {
  free: {
    name: 'Free',
    color: 'from-slate-500 to-slate-600',
    icon: Sparkles,
    message: 'You\'re on the Free plan',
    cta: 'Upgrade to unlock more features',
    showUpgrade: true,
  },
  pro: {
    name: 'Pro',
    color: 'from-primary-500 to-purple-600',
    icon: Crown,
    message: 'You\'re on the Pro plan',
    cta: 'Enjoying Pro? Consider Business for advanced features',
    showUpgrade: true,
  },
  business: {
    name: 'Business',
    color: 'from-accent-500 to-cyan-600',
    icon: TrendingUp,
    message: 'You\'re on the Business plan',
    cta: 'Premium support and unlimited resources',
    showUpgrade: false,
  },
  enterprise: {
    name: 'Enterprise',
    color: 'from-amber-500 to-orange-600',
    icon: Crown,
    message: 'You\'re on the Enterprise plan',
    cta: 'Thank you for choosing Enterprise',
    showUpgrade: false,
  },
}

export function SubscriptionBanner({ tier, expiresAt, onUpgrade }: SubscriptionBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  const info = tierInfo[tier]
  const Icon = info.icon

  if (dismissed) {
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="relative overflow-hidden border-2">
        {/* Gradient Background */}
        <div className={`absolute inset-0 bg-gradient-to-r ${info.color} opacity-5`} />

        <div className="relative p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-4 flex-1">
              {/* Icon */}
              <div className={`p-3 rounded-xl bg-gradient-to-br ${info.color} shadow-lg`}>
                <Icon className="w-6 h-6 text-white" />
              </div>

              {/* Content */}
              <div className="flex-1">
                <div className="flex items-center space-x-3 mb-2">
                  <h3 className="text-lg font-bold">{info.message}</h3>
                  <Badge
                    variant="secondary"
                    className={`bg-gradient-to-r ${info.color} text-white border-0`}
                  >
                    {info.name}
                  </Badge>
                </div>

                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                  {info.cta}
                </p>

                {expiresAt && (
                  <p className="text-xs text-slate-500 dark:text-slate-500 mb-4">
                    Subscription expires: {new Date(expiresAt).toLocaleDateString()}
                  </p>
                )}

                {/* Features Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  {tier === 'free' && (
                    <>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-primary-500" />
                        <span>5 GB Storage</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-primary-500" />
                        <span>1 Concurrent Stream</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-primary-500" />
                        <span>20 Video Assets</span>
                      </div>
                    </>
                  )}
                  
                  {tier === 'pro' && (
                    <>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-primary-500" />
                        <span>50 GB Storage</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-primary-500" />
                        <span>5 Concurrent Streams</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-primary-500" />
                        <span>200 Video Assets</span>
                      </div>
                    </>
                  )}

                  {tier === 'business' && (
                    <>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-accent-500" />
                        <span>200 GB Storage</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-accent-500" />
                        <span>20 Concurrent Streams</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-accent-500" />
                        <span>Priority Support</span>
                      </div>
                    </>
                  )}

                  {tier === 'enterprise' && (
                    <>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                        <span>Unlimited Storage</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                        <span>Unlimited Streams</span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                        <span>Dedicated Support</span>
                      </div>
                    </>
                  )}
                </div>

                {/* CTA Buttons */}
                {info.showUpgrade && (
                  <div className="flex items-center space-x-3">
                    <Button
                      onClick={onUpgrade}
                      className={`bg-gradient-to-r ${info.color} text-white border-0`}
                    >
                      <TrendingUp className="w-4 h-4 mr-2" />
                      {tier === 'free' ? 'Upgrade to Pro' : 'Upgrade to Business'}
                    </Button>
                    <Button variant="ghost" size="sm">
                      Compare Plans
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Dismiss Button */}
            <button
              onClick={() => setDismissed(true)}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
