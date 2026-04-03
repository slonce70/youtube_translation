import { render, waitFor } from '@testing-library/react'
import React from 'react'

const setQueryData = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    setQueryData,
  }),
}))

jest.mock('@/lib/api', () => ({
  api: {
    streams: {
      createWsToken: jest.fn(),
    },
  },
}))

import { useStreamSocket } from '../useStreamSocket'
import { api } from '@/lib/api'
import type { Stream } from '@/lib/types'

class MockWebSocket {
  static instances: MockWebSocket[] = []

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  send = jest.fn()
  close = jest.fn()

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }
}

function TestHarness() {
  useStreamSocket('user-1')
  return null
}

describe('useStreamSocket', () => {
  const originalEnv = process.env
  const originalWebSocket = global.WebSocket
  const createWsToken = api.streams.createWsToken as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    MockWebSocket.instances = []
    createWsToken.mockResolvedValue({
      token: 'ws-token',
      expires_at: Math.floor(Date.now() / 1000) + 60,
    })
    jest.replaceProperty(process, 'env', {
      ...process.env,
      NODE_ENV: 'development',
    })
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    jest.replaceProperty(process, 'env', originalEnv)
    global.WebSocket = originalWebSocket
  })

  it('does not mark a running stream as stopped when websocket snapshot is partial', async () => {
    render(<TestHarness />)

    await waitFor(() => expect(createWsToken).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))

    const socket = MockWebSocket.instances[0]
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'stream_update',
        payload: {},
      }),
    })

    expect(setQueryData).toHaveBeenCalledTimes(1)
    const updater = setQueryData.mock.calls[0][1] as (streams: Stream[] | undefined) => Stream[] | undefined

    const originalStream: Stream = {
      id: 'stream-1',
      playlist_id: null,
      source_type: 'assets',
      name: 'Running stream',
      status: 'running',
      pid: 123,
      log_path: null,
      error_message: null,
      started_at: '2026-04-03T16:58:30.812952Z',
      stopped_at: null,
      video_collection_id: null,
      audio_collection_id: null,
      mix_mode: 'video_only',
      settings_json: {},
      total_duration_seconds: 0,
      created_at: '2026-04-03T16:58:18.337229Z',
      updated_at: '2026-04-03T16:58:18.337229Z',
      stream_assets: [],
      destinations: [],
      scheduled_start_enabled: false,
      scheduled_start_time: null,
      scheduled_stop_time: null,
      uptime_seconds: 42,
      runtime_restart: {
        enabled: true,
        state: 'idle',
        attempts: 0,
        max_attempts: 5,
        next_restart_at: null,
        last_restart_at: null,
        last_failure_at: null,
      },
    }

    const updated = updater([originalStream])

    expect(updated).toEqual([originalStream])
  })
})
