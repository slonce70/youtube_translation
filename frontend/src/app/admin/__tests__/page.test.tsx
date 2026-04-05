import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import React from 'react'
import AdminDashboard from '../page'
import enMessages from '@/messages/en'

const pushMock = jest.fn()

jest.mock('next/navigation', () => {
  const actual = jest.requireActual('next/navigation')
  return {
    ...actual,
    useRouter: () => ({
      push: pushMock,
    }),
    useParams: () => ({}),
  }
})

jest.mock('@/lib/api', () => ({
  api: {
    admin: {
      users: {
        list: jest.fn(),
      },
      streams: {
        listAll: jest.fn(),
      },
      alerts: {
        list: jest.fn(),
      },
    },
    metrics: {
      get: jest.fn(),
    },
  },
}))

const { api } = jest.requireMock('@/lib/api')

function renderAdmin() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
        <AdminDashboard />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

describe('AdminDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    api.admin.users.list.mockResolvedValue({
      items: [],
      summary: { total: 0, active: 0, suspended: 0, paid: 0 },
    })
    api.admin.streams.listAll.mockResolvedValue({
      items: [],
      summary: { total: 0, running: 0, errors: 0, stopped: 0 },
    })
    api.admin.alerts.list.mockResolvedValue({
      items: [],
      summary: { total: 0, unresolved: 0, critical: 0, resolved: 0 },
    })
    api.metrics.get.mockResolvedValue({
      system: {
        cpu: { percent: 12.5, count: 8, frequency_mhz: 3200 },
        memory: { total_gb: 64, available_gb: 40, used_gb: 24, percent: 37.5 },
        disk: { total_gb: 512, used_gb: 256, free_gb: 256, percent: 50 },
        network: { bytes_sent: 0, bytes_recv: 0, packets_sent: 0, packets_recv: 0 },
      },
      streams: {
        total_streams: 0,
        active_streams: 0,
        idle_streams: 0,
        error_streams: 0,
        restart_orchestration: {
          auto_restart_enabled: true,
          scheduled_restart_streams: 0,
          streams_with_retry_history: 0,
          total_restart_attempts: 0,
          max_attempts: 5,
          next_restart_at: null,
        },
      },
      capacity: {
        active_streams: 0,
        estimated_additional_capacity: 12,
        estimated_total_capacity: 12,
        cpu_limited: false,
        memory_limited: false,
      },
    })
  })

  it('loads admin data without crashing', async () => {
    renderAdmin()

    await waitFor(() => expect(api.admin.users.list).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.admin.alerts.list).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.metrics.get).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText(/Admin Dashboard/i)).toBeInTheDocument())
  })


  it('shows real system resource metrics instead of hardcoded storage totals', async () => {
    renderAdmin()

    await waitFor(() => expect(screen.getByText('256 GB / 512 GB')).toBeInTheDocument())
    expect(screen.getByText('24 GB / 64 GB')).toBeInTheDocument()
    expect(screen.getByText('12.5% across 8 cores')).toBeInTheDocument()
  })

  it('navigates via quick action buttons', async () => {
    renderAdmin()

    await waitFor(() => expect(screen.getByText(/System Resources/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /View all users/i }))
    fireEvent.click(screen.getByRole('button', { name: /Monitor streams/i }))
    fireEvent.click(screen.getByRole('button', { name: /Resolve alerts/i }))

    expect(pushMock).toHaveBeenNthCalledWith(1, '/admin/users')
    expect(pushMock).toHaveBeenNthCalledWith(2, '/admin/streams')
    expect(pushMock).toHaveBeenNthCalledWith(3, '/admin/alerts')
  })

  it('renders fallback text for alerts without a user email', async () => {
    api.admin.alerts.list.mockResolvedValueOnce({
      items: [
        {
          alert_id: 'alert-1',
          user_id: null,
          user_email: null,
          alert_type: 'stream_failure',
          severity: 'warning',
          message: 'Recovered after retry',
          resolved: false,
          created_at: '2026-04-05T08:00:00Z',
          resolved_at: null,
          resolved_by: null,
        },
      ],
      summary: { total: 1, unresolved: 1, critical: 0, resolved: 0 },
    })

    renderAdmin()

    await waitFor(() => expect(screen.getByText(/Unknown user/i)).toBeInTheDocument())
  })
})
