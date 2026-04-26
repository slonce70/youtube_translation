'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMessages, useTranslations } from 'next-intl'
import { Check, Minus, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { useDashboardContext } from '../dashboard-context'

type PlanQuality = 'fhd' | 'uhd'
type PlanId = 'free' | 'fhd_start' | 'fhd_flow' | 'fhd_boost' | 'uhd_start' | 'uhd_flow' | 'uhd_boost'

type PlanConfig = {
  id: PlanId
  quality: PlanQuality | 'free'
  href: string
  featured: boolean
  badgeVariant: 'success' | 'secondary'
}

const PLAN_CONFIGS: Record<PlanId, PlanConfig> = {
  free: { id: 'free', quality: 'free', href: '/dashboard', featured: false, badgeVariant: 'secondary' },
  fhd_start: { id: 'fhd_start', quality: 'fhd', href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%20FHD%20Start', featured: false, badgeVariant: 'secondary' },
  fhd_flow: { id: 'fhd_flow', quality: 'fhd', href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%20FHD%20Flow', featured: true, badgeVariant: 'success' },
  fhd_boost: { id: 'fhd_boost', quality: 'fhd', href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%20FHD%20Boost', featured: false, badgeVariant: 'secondary' },
  uhd_start: { id: 'uhd_start', quality: 'uhd', href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%204K%20Start', featured: true, badgeVariant: 'success' },
  uhd_flow: { id: 'uhd_flow', quality: 'uhd', href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%204K%20Flow', featured: false, badgeVariant: 'secondary' },
  uhd_boost: { id: 'uhd_boost', quality: 'uhd', href: 'mailto:support@youtubestreaming.app?subject=Upgrade%3A%204K%20Boost', featured: false, badgeVariant: 'secondary' },
}

const QUALITY_PLAN_ORDER: Record<PlanQuality, PlanId[]> = {
  fhd: ['fhd_start', 'fhd_flow', 'fhd_boost'],
  uhd: ['uhd_start', 'uhd_flow', 'uhd_boost'],
}

type PlanMessage = {
  name: string
  price: string
  period: string
  summary: string
  highlights: string[]
  badge?: string
  ctaLabel: string
}

type ComparisonMessages = {
  title: string
  featureHeader: string
  qualities: Record<PlanQuality, {
    rows: Record<string, { label: string; values: Record<PlanId, string> }>
    booleanRows: Record<string, { label: string; values: Record<PlanId, boolean> }>
  }>
}

type FaqMessage = {
  title: string
  description: string
  email: string
  call: string
  brief: string
}

export default function PlansPage() {
  const tPlans = useTranslations('plans.page')
  const messages = useMessages() as {
    plans?: {
      page?: {
        plans?: Record<PlanId, PlanMessage>
        comparison?: ComparisonMessages
        faq?: FaqMessage
        qualityToggle?: Record<PlanQuality, string>
      }
    }
  }
  const { currentTier } = useDashboardContext()
  const [quality, setQuality] = useState<PlanQuality>('fhd')
  const [selectedPlan, setSelectedPlan] = useState<PlanId>((currentTier ?? 'free') as PlanId)

  const planMessages = messages.plans?.page?.plans ?? ({} as Record<PlanId, PlanMessage>)
  const comparisonMessages = messages.plans?.page?.comparison ?? ({} as ComparisonMessages)
  const faqMessages = messages.plans?.page?.faq ?? ({} as FaqMessage)
  const qualityToggleMessages = messages.plans?.page?.qualityToggle ?? ({} as Record<PlanQuality, string>)

  useEffect(() => {
    if (currentTier && currentTier !== 'free') {
      const tierQuality = PLAN_CONFIGS[currentTier as PlanId]?.quality
      if (tierQuality && tierQuality !== 'free') setQuality(tierQuality)
      setSelectedPlan(currentTier as PlanId)
    }
  }, [currentTier])

  const activePlanOrder = useMemo(() => ['free', ...QUALITY_PLAN_ORDER[quality]] as PlanId[], [quality])
  const comparison = comparisonMessages.qualities?.[quality] ?? { rows: {}, booleanRows: {} }

  const openPlan = (planId: PlanId) => {
    const href = PLAN_CONFIGS[planId].href
    window.open(href, href.startsWith('mailto:') ? '_self' : '_blank', href.startsWith('mailto:') ? undefined : 'noopener')
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="page-title">{tPlans('header.title')}</div>
          <div className="page-sub">{tPlans('header.description')}</div>
        </div>
        <div className="page-actions">
          <Badge variant="indigo"><Sparkles className="h-3.5 w-3.5" /> {tPlans('header.releaseBadge')}</Badge>
        </div>
      </div>

      <div className="toolbar-panel">
        <div className="toolbar-row" style={{ justifyContent: 'space-between' }}>
          <div className="summary-list">
            <div style={{ fontWeight: 700 }}>{tPlans('toolbar.title')}</div>
            <div className="page-sub">{tPlans('toolbar.description')}</div>
          </div>
          <div style={{ display: 'inline-flex', gap: 6, background: 'var(--bg-3)', padding: 4, borderRadius: 8 }}>
            {(['fhd', 'uhd'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                className={quality === tier ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                onClick={() => setQuality(tier)}
              >
                {qualityToggleMessages[tier] ?? tier.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="stats-row">
        {activePlanOrder.map((planId) => {
          const cfg = PLAN_CONFIGS[planId]
          const message = planMessages[planId] ?? ({} as PlanMessage)
          const isCurrent = planId === (currentTier ?? 'free')
          const isSelected = selectedPlan === planId
          return (
            <Card
              key={planId}
              className={isSelected ? 'stat-card active-plan-card' : 'stat-card'}
              style={{ ['--accent' as string]: cfg.featured ? 'var(--green)' : 'var(--indigo)' }}
              onClick={() => setSelectedPlan(planId)}
              role="button"
              tabIndex={0}
            >
              <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {isCurrent ? <Badge variant="live">{tPlans('toolbar.currentPlanBadge')}</Badge> : null}
                  {message.badge ? <Badge variant={cfg.badgeVariant}>{message.badge}</Badge> : null}
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 30,
                      fontWeight: 400,
                      letterSpacing: '-0.015em',
                      lineHeight: 1.05,
                    }}
                  >
                    {message.name ?? planId}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono-app)',
                      fontSize: 38,
                      fontWeight: 400,
                      letterSpacing: '-0.02em',
                      marginTop: 14,
                      color: 'var(--txt)',
                    }}
                  >
                    {message.price ?? tPlans('toolbar.fallbackPrice')}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono-app)',
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.16em',
                      color: 'var(--txt-3)',
                      marginTop: 6,
                    }}
                  >
                    {message.period ?? ''}
                  </div>
                </div>
                <div className="page-sub">{message.summary ?? ''}</div>
                <div className="summary-list" style={{ gap: 8 }}>
                  {(message.highlights ?? []).map((highlight) => (
                    <div key={highlight} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 14 }}>
                      <span style={{ color: 'var(--txt-3)', lineHeight: 1.5 }} aria-hidden="true">·</span>
                      <span style={{ color: 'var(--txt-2)', lineHeight: 1.5 }}>{highlight}</span>
                    </div>
                  ))}
                </div>
                <Button
                  variant={isCurrent ? 'outline' : isSelected ? 'primary' : 'secondary'}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!isSelected) {
                      setSelectedPlan(planId)
                      return
                    }
                    openPlan(planId)
                  }}
                  disabled={isCurrent}
                >
                  {isCurrent ? tPlans('selection.button.current') : (message.ctaLabel || tPlans('selection.button.default'))}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{comparisonMessages.title ?? tPlans('comparison.title')}</CardTitle>
        </CardHeader>
        <CardContent className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{comparisonMessages.featureHeader ?? tPlans('comparison.featureHeader')}</th>
                {activePlanOrder.map((planId) => <th key={planId}>{planMessages[planId]?.name ?? planId}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.entries(comparison.rows ?? {}).map(([rowId, row]) => (
                <tr key={rowId}>
                  <td>{row.label}</td>
                  {activePlanOrder.map((planId) => <td key={`${rowId}-${planId}`}>{row.values?.[planId] ?? tPlans('toolbar.fallbackPrice')}</td>)}
                </tr>
              ))}
              {Object.entries(comparison.booleanRows ?? {}).map(([rowId, row]) => (
                <tr key={rowId}>
                  <td>{row.label}</td>
                  {activePlanOrder.map((planId) => (
                    <td key={`${rowId}-${planId}`}>{row.values?.[planId] ? <Check className="mx-auto h-4 w-4" /> : <Minus className="mx-auto h-4 w-4" />}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{faqMessages.title ?? tPlans('faq.title')}</CardTitle>
        </CardHeader>
        <CardContent className="summary-list">
          <div className="page-sub">{faqMessages.description ?? tPlans('faq.description')}</div>
          <div className="page-actions" style={{ marginLeft: 0 }}>
            <Button variant="outline" onClick={() => window.open('mailto:support@youtubestreaming.app', '_self')}>
              {faqMessages.email ?? tPlans('faq.email')}
            </Button>
            <Button variant="secondary" onClick={() => window.open('https://cal.com/', '_blank', 'noopener')}>
              {faqMessages.call ?? tPlans('faq.call')}
            </Button>
            <Button variant="ghost" onClick={() => window.open('https://docs.google.com/', '_blank', 'noopener')}>
              {faqMessages.brief ?? tPlans('faq.brief')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
