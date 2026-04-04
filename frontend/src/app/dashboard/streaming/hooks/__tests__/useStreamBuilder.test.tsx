import { act, renderHook } from '@testing-library/react'

const invalidateQueries = jest.fn()
const streamsCreate = jest.fn()
const mediaCollectionsCreate = jest.fn()
const mediaCollectionsDelete = jest.fn()
const toastError = jest.fn()
const toastSuccess = jest.fn()
const toastInfo = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries,
  }),
  useMutation: (options: {
    mutationFn: (payload: unknown) => Promise<unknown>
    onError?: (error: Error, variables: unknown) => void
    onSuccess?: (data: unknown, variables: unknown) => void
  }) => ({
    mutateAsync: async (payload: unknown) => {
      try {
        const result = await options.mutationFn(payload)
        options.onSuccess?.(result, payload)
        return result
      } catch (error) {
        options.onError?.(error as Error, payload)
        throw error
      }
    },
    isPending: false,
  }),
}))

jest.mock('@/lib/api', () => ({
  api: {
    streams: {
      create: (...args: unknown[]) => streamsCreate(...args),
    },
    mediaCollections: {
      create: (...args: unknown[]) => mediaCollectionsCreate(...args),
      delete: (...args: unknown[]) => mediaCollectionsDelete(...args),
    },
  },
}))

jest.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}))

jest.mock('@/app/dashboard/dashboard-context', () => ({
  useDashboardContext: () => ({
    user: { id: 'user-1' },
  }),
}))

import { useStreamBuilder } from '../useStreamBuilder'
import type { Destination, MediaCollection } from '@/lib/types'

const destinations: Destination[] = [
  {
    id: 'dest-1',
    name: 'Main channel',
    rtmps_url: 'rtmps://example.test/live',
    enabled: true,
    stream_key_masked: '****',
    created_at: '2026-04-04T00:00:00Z',
    updated_at: '2026-04-04T00:00:00Z',
  },
]

const videoCollections: MediaCollection[] = [
  {
    id: 'video-collection-1',
    user_id: 'user-1',
    name: 'Saved queue',
    description: null,
    collection_type: 'video_background',
    is_active: true,
    origin_playlist_id: null,
    created_at: '2026-04-04T00:00:00Z',
    updated_at: '2026-04-04T00:00:00Z',
    items: [
      {
        id: 'item-1',
        collection_id: 'video-collection-1',
        asset_id: 'video-1',
        position: 0,
        loop_mode: 'loop',
        created_at: '2026-04-04T00:00:00Z',
        updated_at: '2026-04-04T00:00:00Z',
      },
    ],
  },
]

function t(key: string, values?: Record<string, unknown>) {
  if (key === 'generic.errorWithMessage') {
    return `Error: ${values?.message ?? ''}`
  }
  return key
}

describe('useStreamBuilder', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    streamsCreate.mockRejectedValue(new Error('create exploded'))
  })

  it('does not double-toast when stream creation itself fails', async () => {
    const { result } = renderHook(() =>
      useStreamBuilder({
        destinations,
        assets: [],
        videoCollections,
        audioCollections: [],
        streams: [],
        quota: undefined,
        tStreaming: t,
        streamingToasts: t,
      }),
    )

    await act(async () => {
      result.current.handleSelectCollection('video', 'video-collection-1')
    })

    await act(async () => {
      await result.current.handleBuilderSubmit()
    })

    expect(streamsCreate).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Error: create exploded')
    expect(mediaCollectionsDelete).not.toHaveBeenCalled()
  })
})
