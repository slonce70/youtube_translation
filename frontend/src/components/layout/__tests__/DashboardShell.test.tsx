import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { DashboardShell } from '../DashboardShell'
import { DashboardContext } from '@/app/dashboard/dashboard-context'
import { PLAN_DETAILS } from '@/lib/plans'
import type { Stream, SubscriptionTierKey } from '@/lib/types'

const mockPathname = jest.fn()

jest.mock('@/lib/api', () => ({
  api: {
    streams: {
      list: jest.fn(),
    },
  },
}))

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('../Topbar', () => ({
  Topbar: ({
    liveCount,
    showLiveBadge,
  }: {
    liveCount: number
    showLiveBadge?: boolean
  }) => (
    <>
      <div data-testid="topbar-live-count">{liveCount}</div>
      <div data-testid="topbar-live-visible">{showLiveBadge ? 'yes' : 'no'}</div>
    </>
  ),
}))

jest.mock('../Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
  readSidebarCollapsed: () => false,
  writeSidebarCollapsed: jest.fn(),
}))

jest.mock('@/components/ui/CommandPalette', () => ({
  CommandPalette: () => null,
}))

const { api } = jest.requireMock('@/lib/api')

function renderShell({
  cachedStreams,
}: {
  cachedStreams?: Stream[]
} = {}) {
  const queryClient = new QueryClient()
  if (cachedStreams) {
    queryClient.setQueryData(['streams', 'user-1'], cachedStreams)
  }

  const tier = 'free' as SubscriptionTierKey

  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardContext.Provider
        value={{
          user: {
            id: 'user-1',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'test@example.com',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-01-01T00:00:00.000Z',
          },
          signOut: jest.fn(async () => {}),
          refreshUser: jest.fn(async () => {}),
          quota: undefined,
          quotaLoading: false,
          currentTier: tier,
          planDetail: PLAN_DETAILS[tier],
        } as unknown as Parameters<typeof DashboardContext.Provider>[0]['value']}
      >
        <DashboardShell userName="Trend" userEmail="trend@example.com" onSignOut={jest.fn()}>
          <div>child content</div>
        </DashboardShell>
      </DashboardContext.Provider>
    </QueryClientProvider>,
  )
}

describe('DashboardShell', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPathname.mockReturnValue('/dashboard')
  })

  it('reflects cached live stream state without creating its own list fetch', () => {
    renderShell({
      cachedStreams: [
        {
          id: 'stream-live',
          playlist_id: null,
          source_type: 'playlist',
          name: 'Live stream',
          status: 'running',
          pid: 123,
          log_path: null,
          error_message: null,
          started_at: '2026-04-10T20:00:00Z',
          stopped_at: null,
          video_collection_id: null,
          audio_collection_id: null,
          mix_mode: 'video_only',
          settings_json: {},
          total_duration_seconds: 0,
          created_at: '2026-04-10T19:00:00Z',
          updated_at: '2026-04-10T20:00:00Z',
          destinations: [],
          runtime_restart: {
            enabled: true,
            state: 'idle',
            attempts: 0,
            max_attempts: 5,
            next_restart_at: null,
            last_restart_at: null,
            last_failure_at: null,
          },
        } as Stream,
      ],
    })

    expect(screen.getByTestId('topbar-live-count')).toHaveTextContent('1')
    expect(screen.getByTestId('topbar-live-visible')).toHaveTextContent('yes')
    expect(api.streams.list).not.toHaveBeenCalled()
  })

  it('hides the live badge on non-owner routes and does not start a fetch path', () => {
    mockPathname.mockReturnValue('/dashboard/library')

    renderShell()

    expect(screen.getByTestId('topbar-live-count')).toHaveTextContent('0')
    expect(screen.getByTestId('topbar-live-visible')).toHaveTextContent('no')
    expect(api.streams.list).not.toHaveBeenCalled()
  })
})
