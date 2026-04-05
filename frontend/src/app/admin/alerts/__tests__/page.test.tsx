import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import React from 'react'
import AlertsManagement from '../page'
import enMessages from '@/messages/en'

jest.mock('@/lib/api', () => ({
  api: {
    admin: {
      alerts: {
        list: jest.fn(),
        resolve: jest.fn(),
      },
    },
  },
}))

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}))

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

const { api } = jest.requireMock('@/lib/api')

function renderAlertsPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
        <AlertsManagement />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

describe('AlertsManagement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    api.admin.alerts.list.mockResolvedValue({
      items: [
        {
          alert_id: 'alert-1',
          user_id: null,
          user_email: null,
          alert_type: 'collection_depleted',
          severity: 'warning',
          message: "Collection 'BG' no longer contains assets",
          resolved: false,
          created_at: '2026-03-30T08:00:00Z',
          resolved_at: null,
          resolved_by: null,
        },
      ],
      summary: { total: 1, unresolved: 1, critical: 0, resolved: 0 },
    })
  })

  it('renders unresolved alerts with readable content and resolve action', async () => {
    const { container } = renderAlertsPage()

    await waitFor(() => expect(api.admin.alerts.list).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Collection 'BG' no longer contains assets")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument()

    const card = container.querySelector('.ring-amber-500\\/10')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('Unknown user')
  })
})
