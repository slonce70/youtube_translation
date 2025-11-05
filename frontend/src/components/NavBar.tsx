'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Home,
  Library,
  Radio,
  BadgeDollarSign,
  LogOut,
  Menu,
  X,
  ChevronDown,
  User,
  Shield,
} from 'lucide-react'
import { Button } from './ui/Button'
import { DarkModeToggle } from './DarkModeToggle'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'
import { LanguageSwitcher } from './LanguageSwitcher'

interface NavBarProps {
  userEmail?: string
  userName?: string
  onSignOut: () => void
}

const navItems = [
  { href: '/dashboard', labelKey: 'menu.dashboard', icon: Home },
  { href: '/dashboard/library', labelKey: 'menu.library', icon: Library },
  { href: '/dashboard/streaming', labelKey: 'menu.streaming', icon: Radio },
  { href: '/dashboard/plans', labelKey: 'menu.plans', icon: BadgeDollarSign },
] as const

export function NavBar({ userEmail, userName, onSignOut }: NavBarProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const nav = useTranslations('nav')

  useEffect(() => {
    if (!profileMenuOpen) return

    const handleClick = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [profileMenuOpen])

  const displayName = userName || userEmail || nav('profile.fallbackName')
  const profileInitial = displayName.charAt(0).toUpperCase()

  return (
    <nav className="sticky top-0 z-50 glass border-b border-slate-200/60 dark:border-slate-700/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="md:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={nav('mobile.toggle')}
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            <Link href="/dashboard" className="flex items-center space-x-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-glow">
                <Radio className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold gradient-text hidden sm:block">
                {nav('brand.name')}
              </span>
            </Link>
          </div>

          <div className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href
              const Icon = item.icon
              
              return (
                <Link key={item.href} href={item.href}>
                  <motion.div
                    className={cn(
                      'relative px-4 py-2 rounded-lg transition-colors duration-200',
                      isActive
                        ? 'text-primary-600 dark:text-primary-400'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    )}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <div className="flex items-center space-x-2">
                      <Icon className="w-4 h-4" />
                      <span className="text-sm font-medium">{nav(item.labelKey)}</span>
                    </div>
                    
                    {isActive && (
                      <motion.div
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-500 to-accent-500 rounded-full"
                        layoutId="activeTab"
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                  </motion.div>
                </Link>
              )
            })}
          </div>

          <div className="flex items-center space-x-4">
            <DarkModeToggle />
            <LanguageSwitcher />

            <div className="relative" ref={profileMenuRef}>
              <button
                onClick={() => setProfileMenuOpen((open) => !open)}
                className="flex items-center space-x-3 rounded-full border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/40 px-2 py-1.5 shadow-sm hover:border-primary-300 dark:hover:border-primary-600 transition"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-accent-500 text-sm font-semibold text-white">
                  {profileInitial}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{displayName}</p>
                  {userEmail && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{userEmail}</p>
                  )}
                </div>
                <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {profileMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="absolute right-0 mt-3 w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
                >
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{displayName}</p>
                    {userEmail && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">{userEmail}</p>
                    )}
                    <p className="mt-1 inline-flex items-center space-x-1 rounded-full bg-primary-50 dark:bg-primary-900/20 px-2 py-0.5 text-[11px] font-medium text-primary-600 dark:text-primary-300">
                      <Shield className="h-3 w-3" />
                      <span>{nav('profile.freePlanBadge')}</span>
                    </p>
                  </div>

                  <div className="py-2 text-sm">
                    <Link
                      href="/dashboard/profile"
                      onClick={() => setProfileMenuOpen(false)}
                      className="flex items-center space-x-3 px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <User className="h-4 w-4 text-slate-500" />
                      <span>{nav('profile.accountSettings')}</span>
                    </Link>
                    <Link
                      href="/dashboard/plans"
                      onClick={() => setProfileMenuOpen(false)}
                      className="flex items-center space-x-3 px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <BadgeDollarSign className="h-4 w-4 text-slate-500" />
                      <span>{nav('profile.managePlan')}</span>
                    </Link>
                  </div>

                  <div className="border-t border-slate-200 dark:border-slate-800 p-3">
                    <button
                      onClick={() => {
                        setProfileMenuOpen(false)
                        onSignOut()
                      }}
                      className="flex w-full items-center justify-center space-x-2 rounded-lg bg-error-50 dark:bg-error-900/20 px-4 py-2 text-sm font-medium text-error-600 hover:bg-error-100 dark:hover:bg-error-900/30"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>{nav('profile.signOut')}</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden mt-4 -mx-4 rounded-2xl border border-slate-200 bg-white/90 px-4 py-4 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900/90 space-y-2"
          >
            {navItems.map((item) => {
              const isActive = pathname === item.href
              const Icon = item.icon
              
              return (
                <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>
                  <div
                    className={cn(
                      'flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="font-medium">{nav(item.labelKey)}</span>
                  </div>
                </Link>
              )
            })}
            
            <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
              {userEmail && (
                <p className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400">{userEmail}</p>
              )}
              <Link
                href="/dashboard/profile"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center space-x-3 px-4 py-3 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <User className="w-5 h-5" />
                <span>{nav('profile.accountSettings')}</span>
              </Link>
              <button
                onClick={onSignOut}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-error-600 hover:bg-error-50 dark:hover:bg-error-900/20"
              >
                <LogOut className="w-5 h-5" />
                <span className="font-medium">{nav('profile.signOut')}</span>
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </nav>
  )
}
