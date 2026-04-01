import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'

import ProfilePage from '../page'
import { DashboardContext } from '../../dashboard-context'
import { PLAN_DETAILS } from '@/lib/plans'
import enMessages from '@/messages/en'

const updateUserMock = jest.fn()
const signInWithPasswordMock = jest.fn()
const toastErrorMock = jest.fn()

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
      success: jest.fn(),
    },
  }
})

function renderProfilePage() {
  const dashboardValue = {
    user: {
      email: 'owner@example.com',
      user_metadata: { display_name: 'Owner' },
    },
    signOut: async () => undefined,
    refreshUser: async () => undefined,
    quota: undefined,
    quotaLoading: false,
    currentTier: null,
    planDetail: PLAN_DETAILS.free,
  }

  return render(
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
  )
}

describe('ProfilePage password change', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    updateUserMock.mockResolvedValue({ error: null })
    signInWithPasswordMock.mockResolvedValue({ error: null })
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
})
