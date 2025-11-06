import type { SubscriptionTierKey } from '@/lib/types'

export type PlanKey = SubscriptionTierKey

export type SupportLevel = 'community' | 'standard' | 'priority' | 'sameDay' | 'dedicated'

export interface PlanDetail {
  priceUsd: number
  storageGb: number
  dailyLimitHours: number | null
  streams: number
  maxResolution: '1080p' | '2160p'
  maxFps: 30 | 60
  destinations: number
  branding: boolean
  automation: boolean
  supportLevel: SupportLevel
  dedicatedManager: boolean
}

export const PLAN_KEYS: PlanKey[] = [
  'free',
  'fhd_start',
  'fhd_flow',
  'fhd_boost',
  'uhd_start',
  'uhd_flow',
  'uhd_boost',
]

export const PLAN_DETAILS: Record<PlanKey, PlanDetail> = {
  free: {
    priceUsd: 0,
    storageGb: 3,
    dailyLimitHours: 8,
    streams: 1,
    maxResolution: '1080p',
    maxFps: 30,
    destinations: 1,
    branding: false,
    automation: false,
    supportLevel: 'community',
    dedicatedManager: false,
  },
  fhd_start: {
    priceUsd: 10,
    storageGb: 50,
    dailyLimitHours: null,
    streams: 1,
    maxResolution: '1080p',
    maxFps: 30,
    destinations: 3,
    branding: false,
    automation: false,
    supportLevel: 'standard',
    dedicatedManager: false,
  },
  fhd_flow: {
    priceUsd: 20,
    storageGb: 100,
    dailyLimitHours: null,
    streams: 2,
    maxResolution: '1080p',
    maxFps: 60,
    destinations: 6,
    branding: true,
    automation: false,
    supportLevel: 'priority',
    dedicatedManager: false,
  },
  fhd_boost: {
    priceUsd: 35,
    storageGb: 200,
    dailyLimitHours: null,
    streams: 4,
    maxResolution: '1080p',
    maxFps: 60,
    destinations: 10,
    branding: true,
    automation: true,
    supportLevel: 'priority',
    dedicatedManager: false,
  },
  uhd_start: {
    priceUsd: 69,
    storageGb: 200,
    dailyLimitHours: null,
    streams: 1,
    maxResolution: '2160p',
    maxFps: 60,
    destinations: 4,
    branding: true,
    automation: false,
    supportLevel: 'sameDay',
    dedicatedManager: false,
  },
  uhd_flow: {
    priceUsd: 109,
    storageGb: 400,
    dailyLimitHours: null,
    streams: 2,
    maxResolution: '2160p',
    maxFps: 60,
    destinations: 8,
    branding: true,
    automation: true,
    supportLevel: 'sameDay',
    dedicatedManager: false,
  },
  uhd_boost: {
    priceUsd: 159,
    storageGb: 800,
    dailyLimitHours: null,
    streams: 4,
    maxResolution: '2160p',
    maxFps: 60,
    destinations: 12,
    branding: true,
    automation: true,
    supportLevel: 'dedicated',
    dedicatedManager: true,
  },
}
