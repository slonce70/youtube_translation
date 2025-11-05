'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { supabase } from '@/lib/supabase'
import { LoadingState } from '@/components/LoadingState'

export default function HomePage() {
  const router = useRouter()
  const status = useTranslations('common.status')

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        router.push('/login')
      } else {
        router.push('/dashboard')
      }
    }

    checkAuth()
  }, [router])

  return <LoadingState text={status('redirecting')} />
}
