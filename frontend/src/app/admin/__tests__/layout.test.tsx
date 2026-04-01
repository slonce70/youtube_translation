import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import type { ComponentType, ReactNode } from 'react'
import enMessages from '@/messages/en'
import AdminLayout from '../layout'

const pushMock = jest.fn()
const replaceMock = jest.fn()
const accessMock = jest.fn()
const waitForAuthMock = jest.fn(async () => undefined)
const getSessionMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
  usePathname: () => '/admin',
}))

jest.mock('@/lib/api', () => ({
  api: {
    admin: {
      access: (...args: unknown[]) => accessMock(...args),
    },
  },
}))

jest.mock('@/lib/supabase', () => ({
  waitForAuth: () => waitForAuthMock(),
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
    },
  },
}))

jest.mock('@/components/LoadingState', () => ({
  LoadingState: ({ text }: { text?: string }) => <div>{text ?? 'Loading'}</div>,
}))

jest.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      whileHover: _whileHover,
      whileTap: _whileTap,
      ...props
    }: {
      children: ReactNode
      whileHover?: unknown
      whileTap?: unknown
    }) => <div {...props}>{children}</div>,
  },
}))

function renderWithIntl(Layout: ComponentType<{ children: ReactNode }>) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
      <Layout>
        <div>Admin child</div>
      </Layout>
    </NextIntlClientProvider>
  )
}

describe('AdminLayout', () => {
  const originalBypass = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH

  beforeEach(() => {
    jest.clearAllMocks()
    getSessionMock.mockResolvedValue({ data: { session: null } })
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH = originalBypass
  })

  it('uses admin access check in dev bypass without redirecting to login', async () => {
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH = '1'

    accessMock.mockResolvedValue({
      user_id: '00000000-0000-0000-0000-000000000001',
      email: 'dev@example.com',
      full_name: null,
      subscription_tier: 'free',
      subscription_status: 'active',
      is_admin: true,
      is_suspended: false,
    })

    renderWithIntl(AdminLayout)

    await waitFor(() => expect(accessMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Admin child')).toBeInTheDocument())
    expect(waitForAuthMock).not.toHaveBeenCalled()
    expect(replaceMock).not.toHaveBeenCalledWith('/login')
  })

  it('waits for auth initialization before checking the session outside dev bypass', async () => {
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH = '0'
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          user: { id: '00000000-0000-0000-0000-000000000001' },
        },
      },
    })
    accessMock.mockResolvedValue({
      user_id: '00000000-0000-0000-0000-000000000001',
      email: 'owner@example.com',
      full_name: null,
      subscription_tier: 'free',
      subscription_status: 'active',
      is_admin: true,
      is_suspended: false,
    })

    renderWithIntl(AdminLayout)

    await waitFor(() => expect(waitForAuthMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getSessionMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Admin child')).toBeInTheDocument())
    expect(replaceMock).not.toHaveBeenCalledWith('/login')
  })
})
