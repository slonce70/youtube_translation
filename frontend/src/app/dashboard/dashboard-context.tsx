'use client'

import { createContext, useContext } from 'react'

type DashboardContextValue = {
  user: any
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

export const DashboardContext = createContext<DashboardContextValue | undefined>(undefined)

export const useDashboardContext = () => {
  const ctx = useContext(DashboardContext)
  if (!ctx) {
    throw new Error('useDashboardContext must be used within DashboardContext')
  }
  return ctx
}
