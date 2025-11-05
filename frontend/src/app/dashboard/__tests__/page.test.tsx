import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import DashboardPage from '../page'
import { DashboardContext } from '../dashboard-context'

jest.mock('@/lib/api', () => ({
  api: {
    metrics: {
      get: jest.fn(),
    },
  },
}))

const { api } = jest.requireMock('@/lib/api') as typeof import('@/lib/api')

function renderWithProviders(component: React.ReactNode) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardContext.Provider value={{ user: { id: 'user-1' }, signOut: jest.fn(), refreshUser: jest.fn() }}>
        {component}
      </DashboardContext.Provider>
    </QueryClientProvider>
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders metrics when data is available', async () => {
    const metricsData = {
      system: {
        cpu: { percent: 42.5, count: 8 },
        memory: { percent: 68.2, available_gb: 12.3 },
        disk: { free_gb: 120.5, total_gb: 256, percent: 47.1 },
      },
      capacity: {
        estimated_additional_capacity: 4,
      },
      streams: {
        active_streams: 2,
        idle_streams: 1,
        error_streams: 0,
      },
    }

    ;(api.metrics.get as jest.Mock).mockResolvedValue(metricsData)

    renderWithProviders(<DashboardPage />)

    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument()

    await waitFor(() =>
      expect(screen.getByText('CPU Usage')).toBeInTheDocument()
    )

    expect(screen.getByText('42.5%')).toBeInTheDocument()
    const activeCard = screen.getByText('Active Streams').closest('div')
    expect(activeCard).not.toBeNull()
    expect(within(activeCard as HTMLElement).getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/Stream Status/i)).toBeInTheDocument()
  })

  it('shows placeholder when metrics are unavailable', async () => {
    ;(api.metrics.get as jest.Mock).mockResolvedValue(null)

    renderWithProviders(<DashboardPage />)

    await waitFor(() =>
      expect(screen.getByText(/No metrics available/i)).toBeInTheDocument()
    )
  })
})
