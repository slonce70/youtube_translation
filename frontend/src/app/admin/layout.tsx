'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import type { AdminAccessResponse } from '@/lib/types'
import { Shield, Users, Radio, AlertTriangle, Activity, Settings } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/LoadingState'

const adminNavItems = [
  { href: '/admin', label: 'Dashboard', icon: Activity },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/streams', label: 'Streams', icon: Radio },
  { href: '/admin/alerts', label: 'Alerts', icon: AlertTriangle },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [user, setUser] = useState<AdminAccessResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    const checkAdminAccess = async () => {
      setLoading(true)
      setErrorMessage(null)

      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        if (isMounted) {
          setLoading(false)
        }
        router.replace('/login')
        return
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
          setErrorMessage('Admin access required')
        } else {
          setIsAdmin(false)
          setErrorMessage('Unable to verify admin access. Please try again.')
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
  }, [router])

  if (loading) {
    return <LoadingState text="Checking admin access..." />
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-16 h-16 text-error-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            {errorMessage ?? "You don't have permission to access the admin panel."}
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Admin Header */}
      <header className="sticky top-0 z-50 glass border-b border-slate-200/60 dark:border-slate-700/60">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-error-500 to-error-600 flex items-center justify-center shadow-glow">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold gradient-text">Admin Panel</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">System Management</p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <span className="text-sm text-slate-600 dark:text-slate-300">
                {user?.email ?? 'Admin'}
              </span>
              <button
                onClick={() => router.push('/dashboard')}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                Exit Admin
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden lg:block w-64 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 min-h-[calc(100vh-4rem)]">
          <nav className="p-4 space-y-2">
            {adminNavItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href))

              return (
                <Link key={item.href} href={item.href}>
                  <motion.div
                    className={cn(
                      'flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors',
                      isActive
                        ? 'bg-error-50 dark:bg-error-900/20 text-error-600 dark:text-error-400'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    )}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="font-medium">{item.label}</span>
                  </motion.div>
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
