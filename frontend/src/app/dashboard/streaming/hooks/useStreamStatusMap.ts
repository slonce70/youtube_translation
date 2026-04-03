'use client'

import { useMemo } from 'react'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { Stream, StreamStatusResponse } from '@/lib/types'

export function useStreamStatusMap(
  streams: Stream[] | undefined,
  userId?: string,
): Map<string, UseQueryResult<StreamStatusResponse>> {
  const streamStatusQueries = useQueries({
    queries: (streams ?? []).map((stream) => ({
      queryKey: ['stream-status', userId, stream.id],
      queryFn: () => api.streams.status(stream.id),
      enabled: !!userId && Boolean(stream?.id),
      refetchInterval: ['running', 'starting', 'stopping', 'error'].includes(stream.status) ? 5000 : 30000,
      retry: false,
    })),
  }) as UseQueryResult<StreamStatusResponse>[]

  return useMemo(() => {
    const map = new Map<string, UseQueryResult<StreamStatusResponse>>()
    streams?.forEach((stream, index) => {
      const query = streamStatusQueries[index]
      if (stream && query) {
        map.set(stream.id, query)
      }
    })
    return map
  }, [streamStatusQueries, streams])
}
