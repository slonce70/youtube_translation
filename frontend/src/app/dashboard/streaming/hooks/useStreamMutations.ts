'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type {
  DestinationUpdatePayload,
  StreamQualityResponse,
  StreamSchedulePayload,
  StreamStatusResponse,
} from '@/lib/types'

export type DestinationFormState = {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
  provider_connection_id: string | null
}

type StartStreamVariables = {
  streamId: string
  streamName?: string | null
}

type UseStreamMutationsParams = {
  userId?: string
  streamingToasts: (key: string, values?: Record<string, unknown>) => string
  openQualityGate: (state: {
    streamName?: string | null
    quality: StreamQualityResponse
  }) => void
  onDestinationSaved: () => void
  onDeleteStreamSuccess?: (streamId: string) => void
}

export function useStreamMutations({
  userId,
  streamingToasts,
  openQualityGate,
  onDestinationSaved,
  onDeleteStreamSuccess,
}: UseStreamMutationsParams) {
  const queryClient = useQueryClient()
  const [optimisticRunningStreamIds, setOptimisticRunningStreamIds] = useState<string[]>([])
  const [optimisticStoppingStreamIds, setOptimisticStoppingStreamIds] = useState<string[]>([])

  const createDestinationMutation = useMutation({
    mutationFn: (data: DestinationFormState) => api.destinations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations', userId] })
      queryClient.invalidateQueries({ queryKey: ['streams', userId] })
      toast.success(streamingToasts('destination.created'))
      onDestinationSaved()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const updateDestinationMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DestinationFormState }) => {
      const payload: DestinationUpdatePayload = {
        name: data.name,
        rtmps_url: data.rtmps_url,
        enabled: data.enabled,
      }

      if (data.stream_key.trim()) {
        payload.stream_key = data.stream_key.trim()
      }

      payload.provider_connection_id = data.provider_connection_id

      return api.destinations.update(id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations', userId] })
      queryClient.invalidateQueries({ queryKey: ['streams', userId] })
      toast.success(streamingToasts('destination.updated'))
      onDestinationSaved()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const deleteDestinationMutation = useMutation({
    mutationFn: (destinationId: string) => api.destinations.delete(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations', userId] })
      queryClient.invalidateQueries({ queryKey: ['streams', userId] })
      toast.success(streamingToasts('destination.deleted'))
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

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
    createDestinationMutation,
    updateDestinationMutation,
    deleteDestinationMutation,
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
