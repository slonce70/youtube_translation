'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowRight, Radio } from 'lucide-react'
import { Button } from '../ui/Button'

type Props = {
  onStartStreaming?: () => void | Promise<void>
}

export function Footer({ onStartStreaming }: Props) {
  const t = useTranslations('landing.footer')
  const navT = useTranslations('landing.nav')

  const productLinks = [
    { href: '#features', label: navT('features') },
    { href: '#how-it-works', label: navT('howItWorks') },
    { href: '#pricing', label: navT('pricing') },
    { href: '#benefits', label: navT('benefits') },
  ]

  return (
    <footer className="px-4 pb-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="stream-v3-footer overflow-hidden px-6 py-8 sm:px-8 md:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(94,231,255,0.14),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(255,74,98,0.16),transparent_28%)]" />

          <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                  <Radio className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="stream-v3-display text-xl font-semibold text-white tracking-tight">{t('brand.name')}</div>
                  <div className="text-sm text-slate-400">{t('brand.tagline')}</div>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                {productLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-300/30 hover:bg-white/10"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{t('legal.title')}</div>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                {t('copyright')}
              </p>
              <Button
                variant="ghost"
                className="mt-6 w-full rounded-2xl border border-white/10 bg-white text-slate-950 hover:bg-slate-100"
                onClick={() => {
                  if (onStartStreaming) {
                    void onStartStreaming()
                  }
                }}
              >
                {navT('startStreaming')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
