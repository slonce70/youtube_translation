'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { NavBar } from '@/components/NavBar'
import { LoadingState } from '@/components/LoadingState'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DashboardContext } from './dashboard-context'

type Props = {
  children: React.ReactNode
}

export default function DashboardLayout({ children }: Props) {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession()
      const sessionUser = data.session?.user

      if (!sessionUser) {
        router.replace('/login')
        return
      }

      setUser(sessionUser)
      setLoading(false)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        router.replace('/login')
      } else {
        setUser(session.user)
        setLoading(false)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const refreshUser = async () => {
    const { data } = await supabase.auth.getUser()
    if (data.user) {
      setUser(data.user)
    }
  }

  if (loading) {
    return <LoadingState text="Loading dashboard..." />
  }

  return (
    <ErrorBoundary>
      <DashboardContext.Provider value={{ user, signOut: handleSignOut, refreshUser }}>
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
