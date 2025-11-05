'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Check, Minus, Sparkles } from 'lucide-react'
import Link from 'next/link'

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    summary: 'Launch your first streams with guardrails that keep costs down.',
    highlights: ['3 GB memory buffer', '8 hours of streaming per day', '1 destination'],
    badge: 'Current',
    ctaLabel: 'Included',
    href: '/dashboard',
    featured: false,
  },
  {
    name: 'Creator',
    price: '$29',
    period: 'per month',
    summary: 'Longer events and additional destinations for creators growing an audience.',
    highlights: ['12 GB buffer', '24 hours daily streaming', '3 destinations'],
    badge: 'Popular',
    ctaLabel: 'Request upgrade',
    href: 'mailto:support@youtubestreaming.app?subject=Creator%20upgrade%20request',
    featured: true,
  },
  {
    name: 'Studio',
    price: '$79',
    period: 'per month',
    summary: 'Production teams that need parallel streams, playlists, and automation.',
    highlights: ['32 GB buffer', '24/7 streaming', '8 destinations'],
    badge: undefined,
    ctaLabel: 'Talk to us',
    href: 'mailto:support@youtubestreaming.app?subject=Studio%20upgrade%20request',
    featured: false,
  },
  {
    name: 'Enterprise',
    price: "Let's chat",
    period: 'custom',
    summary: 'Scale across regions with SSO, dedicated support, and white-label experiences.',
    highlights: ['Dedicated account team', 'Unlimited destinations', 'Custom SLAs'],
    badge: undefined,
    ctaLabel: 'Book a demo',
    href: 'https://cal.com/',
    featured: false,
  },
]

const comparison = [
  {
    label: 'Memory buffer',
    values: ['3 GB', '12 GB', '32 GB', '64 GB'],
  },
  {
    label: 'Daily streaming limit',
    values: ['8 hours', '24 hours', '24/7', '24/7'],
  },
  {
    label: 'Concurrent streams',
    values: ['1', '3', '6', 'Unlimited'],
  },
  {
    label: 'Destinations',
    values: ['1', '6', '12', 'Unlimited'],
  },
  {
    label: 'Stream calendar & scheduling',
    values: [false, true, true, true],
  },
  {
    label: 'Custom watermark control',
    values: [false, true, true, true],
  },
  {
    label: 'Priority support',
    values: ['Community', 'Email within 24h', 'Same-day', 'Dedicated CSM'],
  },
]

const isBoolean = (value: string | boolean): value is boolean => typeof value === 'boolean'

export default function PlansPage() {
  return (
    <div className="space-y-14 pb-16">
      <section className="max-w-3xl">
        <Badge variant="secondary" className="mb-3 inline-flex items-center space-x-1">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Pick what fits your stream</span>
        </Badge>
        <h1 className="text-3xl font-bold gradient-text mb-2">Plans &amp; Pricing</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Start on the Free tier, then scale memory, airtime, and destinations as your shows grow.
          All plans include analytics, smart encoding, and instant YouTube sync.
        </p>
      </section>

      <section>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={`relative flex h-full flex-col border-2 transition-shadow duration-300 hover:scale-100 ${
                plan.featured
                  ? 'border-primary-400 shadow-xl shadow-primary-500/10 hover:shadow-primary-500/20'
                  : 'border-slate-200 dark:border-slate-800 hover:shadow-lg'
              }`}
            >
            {plan.badge && (
              <Badge
                variant={plan.featured ? 'success' : 'secondary'}
                className="absolute right-4 top-4"
              >
                {plan.badge}
              </Badge>
            )}
            <CardHeader>
              <CardTitle className="text-xl font-semibold">{plan.name}</CardTitle>
              <div className="mt-4">
                <p className="text-3xl font-bold text-slate-900 dark:text-white">{plan.price}</p>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {plan.period}
                </p>
              </div>
            </CardHeader>
            <CardContent className="flex h-full flex-col justify-between space-y-6">
              <p className="text-sm text-slate-600 dark:text-slate-400">{plan.summary}</p>
              <ul className="space-y-3 text-sm">
                {plan.highlights.map((highlight) => (
                  <li key={highlight} className="flex items-start space-x-2 text-slate-700 dark:text-slate-200">
                    <Check className="mt-0.5 h-4 w-4 text-primary-500" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
              <Button
                variant={plan.featured ? 'primary' : 'secondary'}
                onClick={() => {
                  if (plan.href.startsWith('http')) {
                    window.open(plan.href, '_blank', 'noopener')
                  } else {
                    window.open(plan.href, '_self')
                  }
                }}
              >
                {plan.ctaLabel}
              </Button>
            </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-10">
        <Card className="rounded-3xl border border-slate-200/70 bg-white/90 shadow-lg hover:scale-100 dark:border-slate-800/70 dark:bg-slate-900/80">
          <CardHeader>
            <CardTitle>Compare what&apos;s inside</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <th className="px-4 py-3">Feature</th>
                  {plans.map((plan) => (
                    <th key={plan.name} className="px-4 py-3 text-center">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {comparison.map((row) => (
                  <tr key={row.label} className="text-slate-700 dark:text-slate-200">
                    <td className="px-4 py-3 font-medium">{row.label}</td>
                    {row.values.map((value, index) => (
                      <td key={`${row.label}-${plans[index].name}`} className="px-4 py-3 text-center">
                        {isBoolean(value) ? (
                          value ? (
                            <Check className="mx-auto h-4 w-4 text-success-500" />
                          ) : (
                            <Minus className="mx-auto h-4 w-4 text-slate-400" />
                          )
                        ) : (
                          <span>{value}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="hover:scale-100">
          <CardHeader>
            <CardTitle>Questions?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
            <p>
              Upgrade flows are launching soon. Until then, drop us a line and we&apos;ll unlock the right tier
              for your workspace.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => window.open('mailto:support@youtubestreaming.app')}>
                Email support
              </Button>
              <Button variant="ghost" onClick={() => window.open('https://cal.com/', '_blank')}>
                Schedule a call
              </Button>
              <Link
                href="https://docs.google.com/forms/d/e/1FAIpQLSf-demo"
                target="_blank"
                className="text-xs font-medium text-primary-600 hover:underline"
              >
                View enterprise brief
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
