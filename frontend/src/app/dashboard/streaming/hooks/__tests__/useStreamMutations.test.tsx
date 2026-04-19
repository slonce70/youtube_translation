import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const destinationsCreate = jest.fn()
const destinationsUpdate = jest.fn()
const destinationsDelete = jest.fn()
const streamsQuality = jest.fn()
const streamsStart = jest.fn()
const streamsStop = jest.fn()
const streamsUpdate = jest.fn()
const streamsDelete = jest.fn()
const toastError = jest.fn()
const toastSuccess = jest.fn()
const toastInfo = jest.fn()

jest.mock('@/lib/api', () => {
  class MockApiError extends Error {
    status: number
    detail: unknown

    constructor(status: number, detail: unknown) {
      super(typeof detail === 'string' ? detail : `HTTP ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.detail = detail
    }
  }

  return {
    ApiError: MockApiError,
    api: {
      destinations: {
        create: (...args: unknown[]) => destinationsCreate(...args),
        update: (...args: unknown[]) => destinationsUpdate(...args),
        delete: (...args: unknown[]) => destinationsDelete(...args),
      },
      streams: {
        quality: (...args: unknown[]) => streamsQuality(...args),
        start: (...args: unknown[]) => streamsStart(...args),
        stop: (...args: unknown[]) => streamsStop(...args),
        update: (...args: unknown[]) => streamsUpdate(...args),
        delete: (...args: unknown[]) => streamsDelete(...args),
      },
    },
  }
})

jest.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}))

import { ApiError } from '@/lib/api'
import { useStreamMutations } from '../useStreamMutations'
import type { StreamQualityResponse, StreamStatusResponse } from '@/lib/types'

const okQuality: StreamQualityResponse = {
  ok: true,
  tier: 'pro',
  limits: { enforce_stream_quality: true },
  violations: [],
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function t(key: string, values?: Record<string, unknown>) {
  if (key === 'generic.errorWithMessage') {
    return `Error: ${values?.message ?? ''}`
  }
  if (key === 'errors.concurrentLimit') {
    return `Concurrent limit ${values?.current ?? '?'} / ${values?.limit ?? '?'}`
  }
  return key
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function renderUseStreamMutations() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  const invalidateQueriesSpy = jest.spyOn(queryClient, 'invalidateQueries')
  const openQualityGate = jest.fn()
  const onDestinationSaved = jest.fn()
  const onDeleteStreamSuccess = jest.fn()

  const rendered = renderHook(
    () =>
      useStreamMutations({
        userId: 'user-1',
        streamingToasts: t,
        openQualityGate,
        onDestinationSaved,
        onDeleteStreamSuccess,
      }),
    {
      wrapper: createWrapper(queryClient),
    },
  )

  return {
    ...rendered,
    invalidateQueriesSpy,
    openQualityGate,
    onDestinationSaved,
    onDeleteStreamSuccess,
  }
}

describe('useStreamMutations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a destination, invalidates the page-owned lists, and resets the channel form via callback', async () => {
    destinationsCreate.mockResolvedValue({ id: 'dest-1' })

    const { result, invalidateQueriesSpy, onDestinationSaved } = renderUseStreamMutations()
    const payload = {
      name: 'Main channel',
      rtmps_url: 'rtmps://example.test/live',
      stream_key: 'abc123',
      enabled: true,
      provider_connection_id: 'provider-1',
    }

    await act(async () => {
      await result.current.createDestinationMutation.mutateAsync(payload)
    })

    expect(destinationsCreate).toHaveBeenCalledWith(payload)
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['destinations', 'user-1'] })
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['streams', 'user-1'] })
    expect(toastSuccess).toHaveBeenCalledWith('destination.created')
    expect(onDestinationSaved).toHaveBeenCalledTimes(1)
  })

  it('trims destination updates before sending them to the API', async () => {
    destinationsUpdate.mockResolvedValue({ id: 'dest-1' })

    const { result } = renderUseStreamMutations()

    await act(async () => {
      await result.current.updateDestinationMutation.mutateAsync({
        id: 'dest-1',
        data: {
          name: 'Updated channel',
          rtmps_url: 'rtmps://example.test/updated',
          stream_key: '  next-key  ',
          enabled: false,
          provider_connection_id: null,
        },
      })
    })

    expect(destinationsUpdate).toHaveBeenCalledWith('dest-1', {
      name: 'Updated channel',
      rtmps_url: 'rtmps://example.test/updated',
      stream_key: 'next-key',
      enabled: false,
      provider_connection_id: null,
    })
  })

  it('deletes a destination and refreshes the destination and stream lists', async () => {
    destinationsDelete.mockResolvedValue(undefined)

    const { result, invalidateQueriesSpy } = renderUseStreamMutations()

    await act(async () => {
      await result.current.deleteDestinationMutation.mutateAsync('dest-1')
    })

    expect(destinationsDelete).toHaveBeenCalledWith('dest-1')
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['destinations', 'user-1'] })
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['streams', 'user-1'] })
    expect(toastSuccess).toHaveBeenCalledWith('destination.deleted')
  })

  it('updates a stream schedule and refreshes the stream list', async () => {
    streamsUpdate.mockResolvedValue({ id: 'stream-1' })

    const { result, invalidateQueriesSpy } = renderUseStreamMutations()

    await act(async () => {
      await result.current.updateScheduleMutation.mutateAsync({
        streamId: 'stream-1',
        payload: {
          name: 'Morning show',
          destination_ids: ['dest-1'],
          schedule_mode: 'schedule',
          schedule_start_at: '2026-04-20T10:00:00.000Z',
          schedule_stop_at: '2026-04-20T11:00:00.000Z',
        },
      })
    })

    expect(streamsUpdate).toHaveBeenCalledWith('stream-1', {
      name: 'Morning show',
      destination_ids: ['dest-1'],
      schedule_mode: 'schedule',
      schedule_start_at: '2026-04-20T10:00:00.000Z',
      schedule_stop_at: '2026-04-20T11:00:00.000Z',
    })
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['streams', 'user-1'] })
    expect(toastSuccess).toHaveBeenCalledWith('stream.scheduleUpdated')
  })

  it('opens the quality gate instead of starting when stream quality is rejected', async () => {
    const quality: StreamQualityResponse = {
      ok: false,
      tier: 'pro',
      limits: { enforce_stream_quality: true },
      violations: [
        {
          code: 'bitrate_low',
          message: 'Bitrate too low',
          position: 0,
          filename: 'clip.mp4',
        },
      ],
    }
    streamsQuality.mockResolvedValue(quality)

    const { result, openQualityGate } = renderUseStreamMutations()

    await act(async () => {
      await expect(
        result.current.startStreamMutation.mutateAsync({
          streamId: 'stream-1',
          streamName: 'Morning show',
        }),
      ).rejects.toThrow('quality_rejected')
    })

    expect(toastInfo).toHaveBeenCalledWith('Запускаємо трансляцію...')
    expect(openQualityGate).toHaveBeenCalledWith({
      streamName: 'Morning show',
      quality,
    })
    expect(streamsStart).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
    expect(result.current.optimisticRunningStreamIds).toEqual([])
    expect(result.current.pendingStartStreamId).toBeNull()
  })

  it('surfaces the concurrent stream quota toast when the start request is rejected by quota', async () => {
    streamsQuality.mockResolvedValue(okQuality)
    streamsStart.mockRejectedValue(
      new ApiError(429, {
        error: 'quota_exceeded',
        resource: 'concurrent streams',
        current: 2,
        limit: 2,
      }),
    )

    const { result, openQualityGate } = renderUseStreamMutations()

    await act(async () => {
      await expect(
        result.current.startStreamMutation.mutateAsync({
          streamId: 'stream-1',
          streamName: 'Morning show',
        }),
      ).rejects.toThrow('HTTP 429')
    })

    expect(openQualityGate).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Concurrent limit 2 / 2')
    expect(result.current.optimisticRunningStreamIds).toEqual([])
  })

  it('tracks optimistic running and stopping state around start and stop mutations', async () => {
    const startDeferred = createDeferred<StreamStatusResponse>()
    const stopDeferred = createDeferred<StreamStatusResponse>()

    streamsQuality.mockResolvedValue(okQuality)
    streamsStart.mockReturnValue(startDeferred.promise)
    streamsStop.mockReturnValue(stopDeferred.promise)

    const { result, invalidateQueriesSpy } = renderUseStreamMutations()

    act(() => {
      result.current.startStreamMutation.mutate({
        streamId: 'stream-1',
        streamName: 'Morning show',
      })
    })

    await waitFor(() => {
      expect(result.current.pendingStartStreamId).toBe('stream-1')
    })
    expect(result.current.optimisticRunningStreamIds).toEqual(['stream-1'])

    await act(async () => {
      startDeferred.resolve({
        id: 'stream-1',
        status: 'running',
        is_running: true,
        runtime_restart: {
          enabled: false,
          state: 'disabled',
          attempts: 0,
          max_attempts: 0,
        },
      })
      await startDeferred.promise
    })

    await waitFor(() => {
      expect(result.current.pendingStartStreamId).toBeNull()
    })
    expect(result.current.optimisticRunningStreamIds).toEqual(['stream-1'])
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ['stream-status', 'user-1', 'stream-1'],
    })
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['streams', 'user-1'] })
    expect(toastSuccess).toHaveBeenCalledWith('stream.started')

    act(() => {
      result.current.stopStreamMutation.mutate('stream-1')
    })

    await waitFor(() => {
      expect(result.current.pendingStopStreamId).toBe('stream-1')
    })
    expect(result.current.optimisticStoppingStreamIds).toEqual(['stream-1'])

    await act(async () => {
      stopDeferred.resolve({
        id: 'stream-1',
        status: 'stopped',
        is_running: false,
        runtime_restart: {
          enabled: false,
          state: 'disabled',
          attempts: 0,
          max_attempts: 0,
        },
      })
      await stopDeferred.promise
    })

    await waitFor(() => {
      expect(result.current.pendingStopStreamId).toBeNull()
    })
    expect(result.current.optimisticRunningStreamIds).toEqual([])
    expect(result.current.optimisticStoppingStreamIds).toEqual([])
    expect(toastInfo).toHaveBeenCalledWith('stream.stopped')
  })

  it('deletes a stream, invalidates the list, and lets the page clear any open logs for that stream', async () => {
    streamsDelete.mockResolvedValue(undefined)

    const { result, invalidateQueriesSpy, onDeleteStreamSuccess } = renderUseStreamMutations()

    await act(async () => {
      await result.current.deleteStreamMutation.mutateAsync('stream-1')
    })

    expect(streamsDelete).toHaveBeenCalledWith('stream-1')
    expect(toastSuccess).toHaveBeenCalledWith('stream.deleted')
    expect(onDeleteStreamSuccess).toHaveBeenCalledWith('stream-1')
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['streams', 'user-1'] })
  })
})
