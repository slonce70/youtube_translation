import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import React from 'react'
import AdminDashboard from '../page'
import enMessages from '@/messages/en'

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
  })

  it('loads admin data without crashing', async () => {
    renderAdmin()

    await waitFor(() => expect(api.admin.users.list).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.admin.alerts.list).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText(/Admin Dashboard/i)).toBeInTheDocument())
  })
})
