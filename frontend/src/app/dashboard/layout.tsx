'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase, waitForAuth } from '@/lib/supabase'
import { NavBar } from '@/components/NavBar'
import { LoadingState } from '@/components/LoadingState'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DashboardContext } from './dashboard-context'
import { api } from '@/lib/api'
import type { QuotaUsageResponse, SubscriptionTierKey } from '@/lib/types'
import { PLAN_DETAILS } from '@/lib/plans'
import { readDevBypassDisplayName } from '@/lib/devBypassUser'

type Props = {
  children: React.ReactNode
}

const DEV_BYPASS = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1'
const DEV_USER_EMAIL = process.env.NEXT_PUBLIC_DEV_USER_EMAIL ?? 'dev@example.com'
const DEV_USER_ID = process.env.NEXT_PUBLIC_DEV_USER_ID ?? 'dev-user-id'

function buildDevBypassUser() {
  return {
    id: DEV_USER_ID,
    email: DEV_USER_EMAIL,
    user_metadata: { display_name: readDevBypassDisplayName() },
  }
}

export default function DashboardLayout({ children }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [authReady, setAuthReady] = useState(false)

  const {
    data: quota,
    isLoading: quotaLoading,
  } = useQuery<QuotaUsageResponse>({
    queryKey: ['quota', user?.id],
    queryFn: api.quota.get,
    enabled: !!user && authReady,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (DEV_BYPASS) {
      setUser(buildDevBypassUser())
      setAuthReady(true)
      setLoading(false)
      return
    }

    const loadSession = async () => {
      // Wait for auth to be fully initialized
      await waitForAuth()
      
      const { data } = await supabase.auth.getSession()
      const sessionUser = data.session?.user

      if (!sessionUser) {
        router.replace('/login')
        return
      }

      setUser(sessionUser)
      setAuthReady(true)
      setLoading(false)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (DEV_BYPASS) {
        return
      }
      if (!session?.user) {
        queryClient.clear()
        router.replace('/login')
      } else {
        setUser(session.user)
        setAuthReady(true)
        setLoading(false)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [queryClient, router])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    queryClient.clear()
    setUser(null)
    router.replace('/login')
  }

  const refreshUser = async () => {
    if (DEV_BYPASS) {
      setUser(buildDevBypassUser())
      return
    }

    const { data } = await supabase.auth.getUser()
    if (data.user) {
      setUser(data.user)
    }
  }

  if (loading) {
    return <LoadingState />
  }

  const currentTier = quota?.tier ? (quota.tier as SubscriptionTierKey) : null
  const planDetail = currentTier ? PLAN_DETAILS[currentTier] : PLAN_DETAILS['free']

  return (
    <ErrorBoundary>
      <DashboardContext.Provider value={{
        user,
        signOut: handleSignOut,
        refreshUser,
        quota,
        quotaLoading,
        currentTier,
        planDetail,
      }}>
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
          <NavBar
            userEmail={user?.email ?? ''}
            userName={user?.user_metadata?.display_name ?? user?.email ?? ''}
            onSignOut={handleSignOut}
          />
          <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </div>
      </DashboardContext.Provider>
    </ErrorBoundary>
  )
}
