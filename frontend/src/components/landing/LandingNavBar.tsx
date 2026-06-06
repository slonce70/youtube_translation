'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Radio, Menu, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { DarkModeToggle } from '../DarkModeToggle'
import { LanguageSwitcher } from '../LanguageSwitcher'
import { cn } from '@/lib/utils'

type Props = {
  onStartStreaming?: () => void | Promise<void>
}

export function LandingNavBar({ onStartStreaming }: Props) {
  const t = useTranslations('landing.nav')
  const router = useRouter()
  const [scrolled, setScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const navItems = [
    { key: 'features', href: '#features' },
    { key: 'howItWorks', href: '#how-it-works' },
    { key: 'pricing', href: '#pricing' },
    { key: 'benefits', href: '#benefits' },
  ]

  const scrollToSection = (href: string) => {
    const element = document.querySelector(href)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
      setMobileMenuOpen(false)
    }
  }

  return (
    <div className="sticky top-0 z-50 px-4 pt-4 sm:px-6 lg:px-8">
      <nav
        className={cn(
          'mx-auto max-w-7xl rounded-[1.6rem] border px-4 py-3 transition-all duration-300 sm:px-5',
          scrolled
            ? 'border-white/8 bg-[#070b12]/74 shadow-[0_24px_54px_-36px_rgba(0,0,0,0.78)] backdrop-blur-xl'
            : 'border-white/7 bg-[#070b12]/58 shadow-[0_16px_38px_-28px_rgba(0,0,0,0.64)] backdrop-blur-xl'
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-2xl border border-transparent p-2 text-slate-100 transition hover:border-white/10 hover:bg-white/5 md:hidden"
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>

            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/12 bg-gradient-to-br from-[#ff4a62]/30 to-[#66e6ff]/14 shadow-[0_18px_36px_-18px_rgba(0,0,0,0.72)]">
                <Radio className="h-5 w-5 text-white" />
              </div>
              <div className="hidden sm:block">
                <div className="stream-v3-display text-xl font-semibold text-white tracking-tight">
                  {t('brand')}
                </div>
              </div>
            </Link>
          </div>

          <div className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => scrollToSection(item.href)}
                className="rounded-full border border-transparent px-4 py-2 text-sm font-medium text-slate-300/92 transition hover:border-white/10 hover:bg-white/6 hover:text-white"
              >
                {t(item.key)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <DarkModeToggle />
            <LanguageSwitcher />
            <div className="hidden md:block">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full border border-white/12 bg-white/92 px-5 py-2 text-slate-950 shadow-[0_18px_36px_-24px_rgba(0,0,0,0.7)] hover:-translate-y-0.5 hover:bg-white"
                onClick={() => {
                  if (onStartStreaming) {
                    void onStartStreaming()
                  } else {
                    void router.push('/login')
                  }
                }}
              >
                {t('startStreaming')}
              </Button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden md:hidden"
            >
              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="space-y-2">
                  {navItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => scrollToSection(item.href)}
                      className="block w-full rounded-2xl px-4 py-3 text-left text-base font-medium text-slate-100 transition hover:bg-white/5"
                    >
                      {t(item.key)}
                    </button>
                  ))}
                </div>

                <Button
                  variant="ghost"
                  className="mt-4 w-full rounded-2xl border border-white/12 bg-white py-3 text-slate-950 shadow-[0_18px_36px_-24px_rgba(0,0,0,0.7)]"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    if (onStartStreaming) {
                      void onStartStreaming()
                    } else {
                      void router.push('/login')
                    }
                  }}
                >
                  {t('startStreaming')}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </div>
  )
}
