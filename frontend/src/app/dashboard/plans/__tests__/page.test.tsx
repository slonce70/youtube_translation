import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import React from 'react'

import PlansPage from '../page'
import { DashboardContext } from '../../dashboard-context'
import { PLAN_DETAILS } from '@/lib/plans'
import enMessages from '@/messages/en'

describe('PlansPage', () => {
  it('lets paid UHD users browse FHD plans', async () => {
    const contextValue = {
      user: { id: 'user-1' },
      signOut: jest.fn().mockResolvedValue(undefined),
      refreshUser: jest.fn().mockResolvedValue(undefined),
      quotaLoading: false,
      currentTier: 'uhd_boost' as const,
      planDetail: PLAN_DETAILS.uhd_boost,
    }

    render(
      <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
        <DashboardContext.Provider value={contextValue}>
          <PlansPage />
        </DashboardContext.Provider>
      </NextIntlClientProvider>
    )

    await waitFor(() => expect(screen.getAllByText('4K Start').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: 'Full HD' }))

    await waitFor(() => expect(screen.getAllByText('FHD Start').length).toBeGreaterThan(0))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getAllByText('FHD Start').length).toBeGreaterThan(0)
    expect(screen.queryByText('4K Start')).toBeNull()
  })
})
