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
    window.addEventListener('scroll', handleScroll)
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
    <nav
      className={cn(
        'sticky top-0 z-50 transition-all duration-300',
        'glass border-b',
        scrolled
          ? 'border-slate-200/60 dark:border-slate-700/60 shadow-lg'
          : 'border-transparent'
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Logo */}
            <Link href="/" className="flex items-center space-x-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-glow">
                <Radio className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold gradient-text hidden sm:block">
                {t('brand')}
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => scrollToSection(item.href)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                {t(item.key)}
              </button>
            ))}
          </div>

          {/* Right Side Actions */}
          <div className="flex items-center space-x-4">
            <DarkModeToggle />
            <LanguageSwitcher />
            
            <div className="hidden md:flex items-center space-x-3">
              <Button
                size="sm"
                className="shadow-glow"
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

        {/* Mobile Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden pb-4 space-y-2"
            >
              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => scrollToSection(item.href)}
                  className="block w-full text-left px-4 py-3 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t(item.key)}
                </button>
              ))}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                <Button
                  className="w-full shadow-glow"
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
      </div>
    </nav>
  )
}
