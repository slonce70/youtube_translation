'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type {
  StreamQualityResponse,
  StreamSchedulePayload,
  StreamStatusResponse,
} from '@/lib/types'

// IA restructure 2026-04-26: destination create/update/delete mutations
// moved with the Channels card to /dashboard/channels (inline). This hook
// now owns only stream-related mutations.

type StartStreamVariables = {
  streamId: string
  streamName?: string | null
}

type StreamingToastTranslator = (
  key: string,
  values?: any,
  formats?: any,
) => string

type UseStreamMutationsParams = {
  userId?: string
  streamingToasts: StreamingToastTranslator
  openQualityGate: (state: {
    streamName?: string | null
    quality: StreamQualityResponse
  }) => void
  onDeleteStreamSuccess?: (streamId: string) => void
}

export function useStreamMutations({
  userId,
  streamingToasts,
  openQualityGate,
  onDeleteStreamSuccess,
}: UseStreamMutationsParams) {
  const queryClient = useQueryClient()
  const [optimisticRunningStreamIds, setOptimisticRunningStreamIds] = useState<string[]>([])
  const [optimisticStoppingStreamIds, setOptimisticStoppingStreamIds] = useState<string[]>([])

  const updateScheduleMutation = useMutation({
    mutationFn: ({ streamId, payload }: { streamId: string; payload: StreamSchedulePayload }) =>
      api.streams.update(streamId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', userId] })
      toast.success(streamingToasts('stream.scheduleUpdated'))
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const startStreamMutation = useMutation<
    StreamStatusResponse,
    Error & { quality?: StreamQualityResponse },
    StartStreamVariables
  >({
    mutationFn: async ({ streamId }: StartStreamVariables) => {
      const quality = await api.streams.quality(streamId)
      if (!quality.ok) {
        const error = new Error('quality_rejected') as Error & { quality: StreamQualityResponse }
        error.quality = quality
        throw error
      }

      return api.streams.start(streamId)
    },
    onMutate: async (variables) => {
      setOptimisticRunningStreamIds((current) =>
        current.includes(variables.streamId) ? current : [...current, variables.streamId],
      )
      toast.info('Запускаємо трансляцію...')
    },
    onSuccess: (_, variables) => {
      toast.success(streamingToasts('stream.started'))
      queryClient.invalidateQueries({ queryKey: ['stream-status', userId, variables.streamId] })
      queryClient.invalidateQueries({ queryKey: ['streams', userId] })
    },
    onError: (error, variables) => {
      if (variables?.streamId) {
        setOptimisticRunningStreamIds((current) => current.filter((id) => id !== variables.streamId))
      }

      if (error.quality && !error.quality.ok) {
        openQualityGate({ streamName: variables?.streamName, quality: error.quality })
        return
      }

      if (error instanceof ApiError) {
        const detail = error.detail as
          | {
              error?: string
              resource?: string
              current?: number
              limit?: number
              message?: string
            }
          | undefined

        if (detail?.error === 'quota_exceeded') {
          if (detail.resource === 'concurrent streams') {
            const rawCurrent =
              typeof detail.current === 'number'
                ? detail.current
                : typeof (detail as { count?: number }).count === 'number'
                  ? (detail as { count?: number }).count
                  : undefined
            const rawLimit = typeof detail.limit === 'number' ? detail.limit : undefined

            toast.error(
              streamingToasts('errors.concurrentLimit', {
                current: rawCurrent ?? '?',
                limit: rawLimit ?? '?',
              }),
            )
            return
          }

          if (typeof detail.message === 'string' && detail.message.trim()) {
            toast.error(streamingToasts('generic.errorWithMessage', { message: detail.message }))
            return
          }
        }

        if (typeof detail?.message === 'string' && detail.message.trim()) {
          toast.error(streamingToasts('generic.errorWithMessage', { message: detail.message }))
          return
        }
      }

      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const stopStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.stop(streamId),
    onMutate: (streamId) => {
      setOptimisticStoppingStreamIds((current) =>
        current.includes(streamId) ? current : [...current, streamId],
      )
    },
    onSuccess: (_, streamId) => {
      toast.info(streamingToasts('stream.stopped'))
      setOptimisticRunningStreamIds((current) => current.filter((id) => id !== streamId))
      queryClient.invalidateQueries({ queryKey: ['stream-status', userId, streamId] })
      queryClient.invalidateQueries({ queryKey: ['streams', userId] })
    },
    onError: (error: Error, streamId) => {
      setOptimisticStoppingStreamIds((current) => current.filter((id) => id !== streamId))
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message }))
    },
    onSettled: (_, __, streamId) => {
      setOptimisticStoppingStreamIds((current) => current.filter((id) => id !== streamId))
    },
  })

  const deleteStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.delete(streamId),
    onSuccess: (_, streamId) => {
      toast.success(streamingToasts('stream.deleted'))
      onDeleteStreamSuccess?.(streamId)
      queryClient.invalidateQueries({ queryKey: ['streams', userId] })
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const pendingStartStreamId = startStreamMutation.isPending
    ? startStreamMutation.variables?.streamId ?? null
    : null
  const pendingStopStreamId = stopStreamMutation.isPending ? stopStreamMutation.variables ?? null : null
  const pendingDeleteStreamId = deleteStreamMutation.isPending ? deleteStreamMutation.variables ?? null : null

  return {
    updateScheduleMutation,
    startStreamMutation,
    stopStreamMutation,
    deleteStreamMutation,
    optimisticRunningStreamIds,
    optimisticStoppingStreamIds,
    pendingStartStreamId,
    pendingStopStreamId,
    pendingDeleteStreamId,
  }
}
