import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import React from 'react'
import StreamsMonitoring from '../page'
import enMessages from '@/messages/en'

jest.mock('@/lib/api', () => ({
  api: {
    admin: {
      streams: {
        listAll: jest.fn(),
        forceStop: jest.fn(),
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

function renderStreamsPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
        <StreamsMonitoring />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

describe('StreamsMonitoring', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    api.admin.streams.listAll.mockResolvedValue({
      items: [
        {
          stream_id: 'stream-1',
          user_id: 'user-1',
          user_email: 'owner@example.com',
          name: '   ',
          status: 'scheduled',
          playlist_id: null,
          source_type: 'playlist',
          destinations_count: 0,
          started_at: null,
          created_at: '2026-03-30T08:00:00Z',
        },
      ],
      summary: { total: 1, running: 0, errors: 0, stopped: 0 },
    })
  })

  it('renders fallback stream title and translates scheduled status', async () => {
    renderStreamsPage()

    await waitFor(() => expect(api.admin.streams.listAll).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Untitled stream')).toBeInTheDocument()
    expect(screen.getAllByText('Scheduled').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('admin.streams.list.status.scheduled')).not.toBeInTheDocument()
  })
})
