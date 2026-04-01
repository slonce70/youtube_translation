import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import React from 'react'
import AdminSettings from '../page'
import enMessages from '@/messages/en'

jest.mock('@/lib/api', () => ({
  api: {
    admin: {
      access: jest.fn(),
      actions: {
        list: jest.fn(),
      },
    },
  },
}))

const { api } = jest.requireMock('@/lib/api')

function renderSettingsPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
        <AdminSettings />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

describe('AdminSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    api.admin.access.mockResolvedValue({
      email: 'dev@example.com',
      is_admin: true,
      is_suspended: false,
      subscription_tier: 'uhd_boost',
      subscription_status: 'active',
    })
    api.admin.actions.list.mockResolvedValue([])
  })

  it('renders quick actions as direct links without nested buttons', async () => {
    renderSettingsPage()

    await waitFor(() => expect(api.admin.access).toHaveBeenCalledTimes(1))

    const manageUsersLink = screen.getByRole('link', { name: 'Manage users' })
    expect(within(manageUsersLink).queryByRole('button')).not.toBeInTheDocument()

    const monitorStreamsLink = screen.getByRole('link', { name: 'Monitor streams' })
    expect(within(monitorStreamsLink).queryByRole('button')).not.toBeInTheDocument()
  })
})
