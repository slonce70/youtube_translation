import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import React, { type ReactNode } from 'react'
import DashboardPage from '../page'
import { DashboardContext } from '../dashboard-context'
import { PLAN_DETAILS } from '@/lib/plans'
import enMessages from '@/messages/en'
import type { SubscriptionTierKey } from '@/lib/types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  useParams: () => ({}),
}))

jest.mock('@/lib/api', () => ({
  api: {
    quota: {
      get: jest.fn(),
    },
    streams: {
      list: jest.fn(),
      createWsToken: jest.fn(),
    },
    assets: {
      list: jest.fn(),
    },
  },
}))

jest.mock('../streaming/hooks/useStreamSocket', () => ({
  useStreamSocket: () => false,
}))

const { api } = jest.requireMock('@/lib/api')

describe('DashboardPage', () => {
  const quotaData = {
    tier: 'free',
    storage: { used_bytes: 0, used_gb: 0, limit_gb: 5, percent: 0, unlimited: false },
    streams: { active: 0, limit: 1, percent: 0, unlimited: false },
    destinations: { count: 0, limit: 2, percent: 0, unlimited: false },
    playlists: { count: 0, limit: 3, percent: 0, unlimited: false },
    assets: { count: 0, limit: 20, percent: 0, unlimited: false },
    streaming_hours: { used: 0, limit: 8, percent: 0, unlimited: false },
    quality: {
      max_resolution: '1080p',
      max_resolution_height: 1080,
      max_fps: 30,
      allowed_video_codecs: [],
      enforce_stream_quality: true,
    },
  }

  const renderWithProviders = (component: ReactNode) => {
    const queryClient = new QueryClient()
    const tier = (Object.prototype.hasOwnProperty.call(PLAN_DETAILS, quotaData.tier)
      ? quotaData.tier
      : 'free') as SubscriptionTierKey
    const planDetail = PLAN_DETAILS[tier]
    const quotaWithTypedTier = { ...quotaData, tier } as typeof quotaData & { tier: SubscriptionTierKey }

    const contextValue = {
      user: { id: 'user-1' },
      signOut: jest.fn(),
      refreshUser: jest.fn(),
      quota: quotaWithTypedTier,
      quotaLoading: false,
      currentTier: tier,
      planDetail,
    }

    return render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
          <DashboardContext.Provider value={contextValue}>{component}</DashboardContext.Provider>
        </NextIntlClientProvider>
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    api.quota.get.mockResolvedValue(quotaData)
    api.streams.list.mockResolvedValue([])
    api.streams.createWsToken.mockResolvedValue({
      token: 'test-ws-token',
      expires_at: Math.floor(Date.now() / 1000) + 60,
    })
    api.assets.list.mockResolvedValue([])
  })

  it('renders dashboard shell content and requests dashboard data', async () => {
    renderWithProviders(<DashboardPage />)

    await waitFor(() => expect(api.streams.list).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.assets.list).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Дашборд')).toBeInTheDocument())
    expect(screen.getByText('🎙️ Почати трансляцію')).toBeInTheDocument()
  })
})
