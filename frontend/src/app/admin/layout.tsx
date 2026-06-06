'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase, waitForAuth } from '@/lib/supabase'
import { api } from '@/lib/api'
import type { AdminAccessResponse } from '@/lib/types'
import { Shield, Users, Radio, AlertTriangle, Activity, Settings } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/LoadingState'
import { useTranslations } from 'next-intl'

const adminNavItems = [
  { href: '/admin', labelKey: 'dashboard', icon: Activity },
  { href: '/admin/users', labelKey: 'users', icon: Users },
  { href: '/admin/streams', labelKey: 'streams', icon: Radio },
  { href: '/admin/alerts', labelKey: 'alerts', icon: AlertTriangle },
  { href: '/admin/settings', labelKey: 'settings', icon: Settings },
] as const

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const layout = useTranslations('admin.layout')
  const devBypass = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1'
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [user, setUser] = useState<AdminAccessResponse | null>(null)
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    const checkAdminAccess = async () => {
      setLoading(true)
      setErrorMessageKey(null)

      if (!devBypass) {
        await waitForAuth()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          if (isMounted) {
            setLoading(false)
          }
          router.replace('/login')
          return
        }
      }

      try {
        const access = await api.admin.access()
        if (!isMounted) {
          return
        }

        setUser(access)
        setIsAdmin(access.is_admin)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'

        if (message.toLowerCase().includes('not authenticated') || message.includes('401')) {
          router.replace('/login')
          return
        }

        if (!isMounted) {
          return
        }

        if (message.toLowerCase().includes('admin access required') || message.includes('403')) {
          setIsAdmin(false)
          setErrorMessageKey('errors.accessRequired')
        } else {
          setIsAdmin(false)
          setErrorMessageKey('errors.verifyFailed')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    checkAdminAccess()
    return () => {
      isMounted = false
    }
  }, [devBypass, router])

  if (loading) {
    return <LoadingState text={layout('checkingAccess')} />
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-16 h-16 text-error-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">{layout('accessDenied.title')}</h1>
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            {layout(errorMessageKey ?? 'errors.default')}
          </p>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            {layout('accessDenied.cta')}
          </button>
        </div>
      </div>
    )
  }

  const getNavItemClasses = (isActive: boolean) =>
    cn(
      'flex items-center rounded-lg transition-colors',
      isActive
        ? 'bg-error-50 dark:bg-error-900/20 text-error-600 dark:text-error-400'
        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
    )

  return (
    <div className="admin-shell min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Admin Header */}
      <header className="admin-header sticky top-0 z-50 border-b border-slate-200/60 dark:border-slate-800/80">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="admin-brand-mark w-10 h-10 rounded-xl flex items-center justify-center">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="admin-title text-xl font-bold">{layout('header.title')}</h1>
                <p className="admin-subtitle text-xs">{layout('header.subtitle')}</p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <span className="admin-user-pill text-sm">
                {user?.email ?? layout('userFallback')}
              </span>
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="admin-exit-btn text-sm"
              >
                {layout('actions.exit')}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="admin-mobile-nav border-b border-slate-200 dark:border-slate-800 lg:hidden">
        <nav className="overflow-x-auto px-4 sm:px-6">
          <div className="flex min-w-max items-center gap-2 py-3">
            {adminNavItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href))

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(getNavItemClasses(isActive), 'gap-2 px-3 py-2 text-sm font-medium whitespace-nowrap')}
                >
                  <Icon className="w-4 h-4" />
                  <span>{layout(`nav.${item.labelKey}`)}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>

      <div className="flex min-w-0">
        {/* Sidebar */}
        <aside className="admin-sidebar hidden lg:block w-72 min-h-[calc(100vh-4rem)]">
          <nav className="p-4 space-y-2">
            {adminNavItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href))

              return (
                <Link key={item.href} href={item.href}>
                  <motion.div
                    className={cn(getNavItemClasses(isActive), 'admin-nav-item space-x-3 px-4 py-3')}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="font-medium">{layout(`nav.${item.labelKey}`)}</span>
                  </motion.div>
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
