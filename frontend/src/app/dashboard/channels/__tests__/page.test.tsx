import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'

import ChannelsPage from '../page'
import { DashboardContext } from '../../dashboard-context'
import { PLAN_DETAILS } from '@/lib/plans'
import enMessages from '@/messages/en'

jest.mock('@/lib/api', () => ({
  api: {
    destinations: {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    youtube: {
      listConnections: jest.fn().mockResolvedValue([]),
      oauthConfig: jest.fn().mockResolvedValue({ configured: true }),
      oauthStart: jest.fn(),
    },
  },
}))

const { api } = jest.requireMock('@/lib/api')

const renderChannelsPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const contextValue = {
    user: {
      id: 'user-1',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'operator@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
    signOut: jest.fn().mockResolvedValue(undefined),
    refreshUser: jest.fn().mockResolvedValue(undefined),
    quotaLoading: false,
    currentTier: 'free' as const,
    planDetail: PLAN_DETAILS.free,
  } as unknown as Parameters<typeof DashboardContext.Provider>[0]['value']

  return render(
    <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
      <QueryClientProvider client={queryClient}>
        <DashboardContext.Provider value={contextValue}>
          <ChannelsPage />
        </DashboardContext.Provider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  )
}

describe('ChannelsPage', () => {
  it('prefills new YouTube channels with the recommended secure RTMPS ingest URL', async () => {
    renderChannelsPage()

    fireEvent.click(await screen.findByRole('button', { name: '+ Add channel' }))

    expect(
      await screen.findByDisplayValue('rtmps://a.rtmps.youtube.com/live2'),
    ).toBeInTheDocument()
  })

  it('disables YouTube OAuth when deployment config is missing', async () => {
    api.youtube.oauthConfig.mockResolvedValueOnce({ configured: false })

    renderChannelsPage()

    fireEvent.click(await screen.findByRole('button', { name: '+ Add channel' }))

    expect(await screen.findByRole('button', { name: /Connect YouTube OAuth/ })).toBeDisabled()
    expect(
      screen.getByText(/YouTube OAuth is not configured on this deployment/),
    ).toBeInTheDocument()
  })
})
