import { renderHook } from '@testing-library/react'

const useQueryMock = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: object) => useQueryMock(options),
}))

import { useStreamingPageData } from '../useStreamingPageData'

describe('useStreamingPageData', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useQueryMock.mockImplementation(
      ({ queryKey }: { queryKey: unknown[] }) =>
        ({
          data: queryKey[0] === 'streams' ? [{ id: 'stream-1', status: 'running' }] : [],
          isLoading: false,
        }) as const,
    )
  })

  it('keeps the streaming page as the list owner with a 3 second refresh interval', () => {
    const { result } = renderHook(() =>
      useStreamingPageData({
        userId: 'user-1',
        quota: undefined,
        tStreaming: (key) => key,
      }),
    )

    const streamQueryCall = useQueryMock.mock.calls.find(
      ([options]) => (options as { queryKey: unknown[] }).queryKey[0] === 'streams',
    )
    const streamQueryOptions = streamQueryCall?.[0] as
      | {
          queryKey: unknown[]
          enabled?: boolean
          refetchInterval?: number | false
        }
      | undefined

    expect(streamQueryOptions).toMatchObject({
      queryKey: ['streams', 'user-1'],
      enabled: true,
      refetchInterval: 3000,
    })
    expect(result.current.streams).toEqual([{ id: 'stream-1', status: 'running' }])
  })
})
