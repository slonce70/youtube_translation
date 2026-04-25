'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { supabase, waitForAuth } from '@/lib/supabase'
import { LoadingState } from '@/components/LoadingState'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DashboardContext } from './dashboard-context'
import { api } from '@/lib/api'
import type { QuotaUsageResponse, SubscriptionTierKey } from '@/lib/types'
import { PLAN_DETAILS } from '@/lib/plans'
import { readDevBypassDisplayName } from '@/lib/devBypassUser'
import { DashboardShell } from '@/components/layout/DashboardShell'

type Props = {
  children: React.ReactNode
}

const DEV_BYPASS = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1'
const DEV_USER_EMAIL = process.env.NEXT_PUBLIC_DEV_USER_EMAIL ?? 'dev@example.com'
const DEV_USER_ID = process.env.NEXT_PUBLIC_DEV_USER_ID ?? 'dev-user-id'

// Dev-bypass user shape: a minimal subset of the Supabase User contract
// (id + email + user_metadata) that matches what the dashboard reads. The
// rest of the fields are filled with sensible empties so the value is
// type-compatible with `User` for the dashboard's read-only consumers.
//
// IMPORTANT: this is a DEV-ONLY path gated on NEXT_PUBLIC_DEV_BYPASS_AUTH.
// Production code must NEVER see this object. Optional User fields not set
// here (phone, identities, factors, last_sign_in_at, etc.) will be
// `undefined` — components that read them must defend with `?.` access.
// If a future component starts depending on, say, `user.identities`, add
// a sensible default to this builder rather than asserting non-null at the
// call site.
function buildDevBypassUser(): User {
  const now = new Date().toISOString()
  return {
    id: DEV_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: DEV_USER_EMAIL,
    app_metadata: {},
    user_metadata: { display_name: readDevBypassDisplayName() },
    created_at: now,
  } as User
}

export default function DashboardLayout({ children }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
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
  const planDetail = currentTier ? PLAN_DETAILS[currentTier] : PLAN_DETAILS.free
  const userName = user?.user_metadata?.display_name ?? user?.email ?? ''

  return (
    <ErrorBoundary>
      <DashboardContext.Provider
        value={{
          user,
          signOut: handleSignOut,
          refreshUser,
          quota,
          quotaLoading,
          currentTier,
          planDetail,
        }}
      >
        <DashboardShell userName={userName} userEmail={user?.email ?? ''} onSignOut={handleSignOut}>
          {children}
        </DashboardShell>
      </DashboardContext.Provider>
    </ErrorBoundary>
  )
}
