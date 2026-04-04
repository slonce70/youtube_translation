import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'

import ProfilePage from '../page'
import { DashboardContext } from '../../dashboard-context'
import { PLAN_DETAILS } from '@/lib/plans'
import enMessages from '@/messages/en'
import { DEV_BYPASS_DISPLAY_NAME_STORAGE_KEY } from '@/lib/devBypassUser'

const updateUserMock = jest.fn()
const signInWithPasswordMock = jest.fn()
const toastErrorMock = jest.fn()
const toastSuccessMock = jest.fn()

jest.mock('@/lib/supabase', () => {
  return {
    supabase: {
      auth: {
        updateUser: (...args: unknown[]) => updateUserMock(...args),
        signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
      },
    },
  }
})

jest.mock('sonner', () => {
  return {
    toast: {
      error: (...args: unknown[]) => toastErrorMock(...args),
      success: (...args: unknown[]) => toastSuccessMock(...args),
    },
  }
})

function renderProfilePage(overrides?: Partial<React.ContextType<typeof DashboardContext>>) {
  const refreshUser = jest.fn().mockResolvedValue(undefined)
  const dashboardValue = {
    user: {
      email: 'owner@example.com',
      user_metadata: { display_name: 'Owner' },
    },
    signOut: async () => undefined,
    refreshUser,
    quota: undefined,
    quotaLoading: false,
    currentTier: null,
    planDetail: PLAN_DETAILS.free,
    ...overrides,
  }

  return {
    refreshUser,
    ...render(
    React.createElement(
      NextIntlClientProvider as any,
      {
        locale: 'en',
        messages: enMessages as unknown as AbstractIntlMessages,
      }
      ,
      React.createElement(
        DashboardContext.Provider as any,
        { value: dashboardValue },
        React.createElement(ProfilePage)
      )
    )
  )}
}

describe('ProfilePage password change', () => {
  const originalBypass = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH

  beforeEach(() => {
    jest.clearAllMocks()
    updateUserMock.mockResolvedValue({ error: null })
    signInWithPasswordMock.mockResolvedValue({ error: null })
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH = '0'
    window.localStorage.clear()
  })

  afterAll(() => {
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH = originalBypass
  })

  it('requires the current password before attempting password change', () => {
    renderProfilePage()

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-password-123' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'new-password-123' },
    })

    const passwordForm = screen.getByRole('button', { name: 'Update password' }).closest('form')
    if (!(passwordForm instanceof HTMLFormElement)) {
      throw new Error('Password form not found')
    }

    fireEvent.submit(passwordForm)

    expect(toastErrorMock).toHaveBeenCalledWith('Enter your current password to change it')
    expect(signInWithPasswordMock).not.toHaveBeenCalled()
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('stores the display name locally in dev bypass mode', async () => {
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH = '1'
    const { refreshUser } = renderProfilePage()

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'QA Browser User' },
    })

    const profileForm = screen.getByRole('button', { name: 'Save changes' }).closest('form')
    if (!(profileForm instanceof HTMLFormElement)) {
      throw new Error('Profile form not found')
    }

    fireEvent.submit(profileForm)

    await waitFor(() => {
      expect(window.localStorage.getItem(DEV_BYPASS_DISPLAY_NAME_STORAGE_KEY)).toBe('QA Browser User')
      expect(updateUserMock).not.toHaveBeenCalled()
      expect(refreshUser).toHaveBeenCalled()
      expect(toastSuccessMock).toHaveBeenCalledWith('Profile updated')
    })
  })
})
