'use client'

import { createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'
import type { QuotaUsageResponse, SubscriptionTierKey } from '@/lib/types'
import type { PlanDetail } from '@/lib/plans'

type DashboardContextValue = {
  user: User | null
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  quota?: QuotaUsageResponse
  quotaLoading: boolean
  currentTier: SubscriptionTierKey | null
  planDetail: PlanDetail
}

export const DashboardContext = createContext<DashboardContextValue | undefined>(undefined)

export const useDashboardContext = () => {
  const ctx = useContext(DashboardContext)
  if (!ctx) {
    throw new Error('useDashboardContext must be used within DashboardContext')
  }
  return ctx
}
