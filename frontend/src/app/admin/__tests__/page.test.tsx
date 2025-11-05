import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import AdminDashboard from '../page'

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
  },
}))

const { api } = jest.requireMock('@/lib/api') as typeof import('@/lib/api')

function renderAdmin() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminDashboard />
    </QueryClientProvider>
  )
}

describe('AdminDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders summary stats based on API data', async () => {
    ;(api.admin.users.list as jest.Mock).mockResolvedValue([
      { id: '1', email: 'a@example.com', is_suspended: false, current_storage_bytes: 1024 ** 3 },
      { id: '2', email: 'b@example.com', is_suspended: true, current_storage_bytes: 2 * 1024 ** 3 },
    ])
    ;(api.admin.streams.listAll as jest.Mock).mockResolvedValue([
      { id: 's1', status: 'running' },
      { id: 's2', status: 'error' },
    ])
    ;(api.admin.alerts.list as jest.Mock).mockResolvedValue([
      { id: 'a1', severity: 'critical', message: 'Stream failure' },
      { id: 'a2', severity: 'warning', message: 'Storage high' },
    ])

    renderAdmin()

    await waitFor(() => expect(screen.getByText(/Admin Dashboard/i)).toBeInTheDocument())

    const totalUsersStat = screen.getByText('Total Users').closest('div')
    expect(totalUsersStat?.textContent).toContain('2')

    const alertsStat = screen.getByText('Unresolved Alerts').closest('div')
    expect(alertsStat?.textContent).toContain('2')
  })

  it('handles empty datasets gracefully', async () => {
    ;(api.admin.users.list as jest.Mock).mockResolvedValue([])
    ;(api.admin.streams.listAll as jest.Mock).mockResolvedValue([])
    ;(api.admin.alerts.list as jest.Mock).mockResolvedValue([])

    renderAdmin()

    await waitFor(() => expect(screen.getByText('Total Users')).toBeInTheDocument())
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })
})
