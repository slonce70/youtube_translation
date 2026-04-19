import { act, renderHook, waitFor } from '@testing-library/react'

import { UPLOAD_STATUS_POLL_SCHEDULE_MS } from '../../upload-status-poll'
import { useLibraryUploads } from '../useLibraryUploads'

var mockInvalidateQueries = jest.fn()
var mockRefetchQueries = jest.fn()
var mockCreateUploadToken = jest.fn()
var mockGetUploadStatus = jest.fn()
var mockToastLoading = jest.fn<string, [string, { id?: string }?]>(() => 'toast-id')
var mockToastSuccess = jest.fn<void, [string, { id?: string }?]>()
var mockToastError = jest.fn<void, [string, { id?: string }?]>()

type EventHandler = (...args: unknown[]) => void
type MockQueuedFile = { id: string }

class MockUppy {
  private handlers = new Map<string, Set<EventHandler>>()

  use = jest.fn().mockReturnThis()
  getPlugin = jest.fn(() => null)
  removePlugin = jest.fn()
  on = jest.fn((event: string, handler: EventHandler) => {
    const listeners = this.handlers.get(event) ?? new Set<EventHandler>()
    listeners.add(handler)
    this.handlers.set(event, listeners)
  })
  off = jest.fn((event: string, handler: EventHandler) => {
    this.handlers.get(event)?.delete(handler)
  })
  setMeta = jest.fn()
  cancelAll = jest.fn()
  removeFiles = jest.fn()
  addFiles = jest.fn()
  getFiles = jest.fn<MockQueuedFile[], []>(() => [])

  emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((handler) => handler(...args))
  }
}

const mockUppyInstances: MockUppy[] = []

function mockUppyConstructor() {
  const instance = new MockUppy()
  mockUppyInstances.push(instance)
  return instance
}

function mockTusPlugin() {
  return null
}

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    refetchQueries: mockRefetchQueries,
  }),
}))

jest.mock('@uppy/core', () => ({
  __esModule: true,
  default: mockUppyConstructor,
}))

jest.mock('@uppy/tus', () => ({
  __esModule: true,
  default: mockTusPlugin,
}))

jest.mock('sonner', () => ({
  toast: {
    loading: (message: string, options?: { id?: string }) => mockToastLoading(message, options),
    success: (message: string, options?: { id?: string }) => mockToastSuccess(message, options),
    error: (message: string, options?: { id?: string }) => mockToastError(message, options),
  },
}))

jest.mock('@/lib/api', () => ({
  api: {
    assets: {
      createUploadToken: (...args: unknown[]) => mockCreateUploadToken(...args),
      getUploadStatus: (...args: unknown[]) => mockGetUploadStatus(...args),
    },
  },
  ApiError: class ApiError extends Error {
    status: number

    constructor(message?: string, status = 500) {
      super(message)
      this.status = status
    }
  },
}))

function tLibrary(key: string, values?: Record<string, unknown>) {
  if (values && 'message' in values) {
    return `${key}:${String(values.message)}`
  }

  return key
}

async function flushAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useLibraryUploads', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    mockUppyInstances.length = 0

    mockCreateUploadToken
      .mockResolvedValueOnce({
        token: 'token-1',
        expires_at: new Date(Date.now() + 65_000).toISOString(),
      })
      .mockResolvedValueOnce({
        token: 'token-2',
        expires_at: new Date(Date.now() + 120_000).toISOString(),
      })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('creates an upload token on mount, syncs Uppy meta, and schedules a refresh before expiry', async () => {
    renderHook(() =>
      useLibraryUploads({
        userId: 'user-1',
        libraryToasts: tLibrary,
      }),
    )

    await waitFor(() => expect(mockCreateUploadToken).toHaveBeenCalledTimes(1))

    const uppy = mockUppyInstances[0]
    expect(uppy.use).toHaveBeenCalledWith(
      mockTusPlugin,
      expect.objectContaining({
        endpoint: expect.any(String),
      }),
    )
    expect(uppy.setMeta).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }))
    expect(uppy.setMeta).toHaveBeenCalledWith({ upload_token: 'token-1' })

    await act(async () => {
      await flushAsyncWork()
    })

    await act(async () => {
      await flushAsyncWork()
    })

    expect(jest.getTimerCount()).toBeGreaterThan(0)
  })

  it('finalizes successful uploads and closes the modal after backend processing completes', async () => {
    mockGetUploadStatus.mockResolvedValue({ status: 'finalized' })

    const { result } = renderHook(() =>
      useLibraryUploads({
        userId: 'user-1',
        libraryToasts: tLibrary,
      }),
    )

    await waitFor(() => expect(mockCreateUploadToken).toHaveBeenCalledTimes(1))

    const uppy = mockUppyInstances[0]
    uppy.getFiles.mockReturnValue([{ id: 'file-1' }])

    act(() => {
      result.current.openUploadModal()
    })

    expect(result.current.isUploadOpen).toBe(true)

    await act(async () => {
      uppy.emit('complete', {
        successful: [
          {
            id: 'file-1',
            name: 'demo.mp4',
            size: 1024,
            response: {
              body: {
                upload_id: 'upload-1',
              },
            },
          },
        ],
      })
      await flushAsyncWork()
    })

    expect(result.current.isProcessingUpload).toBe(true)
    expect(result.current.uploadStatusOverrides).toEqual({
      'file-1': { status: 'processing' },
    })

    await act(async () => {
      jest.advanceTimersByTime(UPLOAD_STATUS_POLL_SCHEDULE_MS[0])
      await flushAsyncWork()
    })

    await waitFor(() => expect(mockGetUploadStatus).toHaveBeenCalledWith('upload-1'))
    await waitFor(() => expect(result.current.isProcessingUpload).toBe(false))

    expect(result.current.isUploadOpen).toBe(false)
    expect(result.current.uploadStatusOverrides).toEqual({})
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['assets', 'user-1'] })
    expect(mockRefetchQueries).toHaveBeenCalledWith({
      queryKey: ['assets', 'user-1'],
      type: 'active',
    })
    expect(mockToastLoading).toHaveBeenCalledWith('upload.finalizing', undefined)
    expect(mockToastSuccess).toHaveBeenCalledWith('upload.processed', { id: 'toast-id' })
    expect(uppy.cancelAll).toHaveBeenCalledTimes(1)
    expect(uppy.removeFiles).toHaveBeenCalledWith(['file-1'])
  })
})
