import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import React from 'react'
import UsersManagement from '../page'
import enMessages from '@/messages/en'

jest.mock('@/lib/api', () => ({
  api: {
    admin: {
      users: {
        list: jest.fn(),
        suspend: jest.fn(),
        unsuspend: jest.fn(),
        changeTier: jest.fn(),
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
const { toast } = jest.requireMock('sonner')

function renderUsersPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
        <UsersManagement />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

describe('UsersManagement', () => {
  const createObjectURLMock = jest.fn(() => 'blob:admin-users')
  const revokeObjectURLMock = jest.fn()
  const anchorClickMock = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(window, 'URL', {
      writable: true,
      value: {
        ...window.URL,
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      },
    })

    jest.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName)
      if (tagName === 'a') {
        Object.defineProperty(element, 'click', {
          value: anchorClickMock,
          configurable: true,
        })
      }
      return element
    }) as typeof document.createElement)

    api.admin.users.list.mockResolvedValue({
      items: [
        {
          user_id: 'user-1',
          email: 'dev@example.com',
          full_name: 'Dev User',
          subscription_tier: 'uhd_boost',
          subscription_status: 'active',
          subscription_started_at: '2026-03-30T08:00:00Z',
          subscription_expires_at: null,
          is_suspended: false,
          current_storage_bytes: 2147483648,
          total_stream_hours: 12.5,
          created_at: '2026-03-30T08:00:00Z',
          last_login_at: '2026-03-30T09:00:00Z',
        },
      ],
      summary: { total: 1, active: 1, suspended: 0, paid: 1 },
    })
    api.admin.users.suspend.mockResolvedValue({ status: 'success' })
    api.admin.users.unsuspend.mockResolvedValue({ status: 'success' })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('exports the filtered users list as csv', async () => {
    renderUsersPage()

    await waitFor(() => expect(api.admin.users.list).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('dev@example.com')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    expect(anchorClickMock).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:admin-users')
  })

  it('uses an in-page dialog to suspend a user', async () => {
    renderUsersPage()

    await waitFor(() => expect(screen.getByText('dev@example.com')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Suspension reason'), {
      target: { value: 'Chargeback abuse' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Suspend user' }))

    await waitFor(() =>
      expect(api.admin.users.suspend).toHaveBeenCalledWith('user-1', 'Chargeback abuse')
    )
  })

  it('shows an error if suspension reason is empty', async () => {
    renderUsersPage()

    await waitFor(() => expect(screen.getByText('dev@example.com')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suspend user' }))

    expect(api.admin.users.suspend).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })
})
