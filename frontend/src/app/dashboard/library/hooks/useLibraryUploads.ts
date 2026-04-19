'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Uppy from '@uppy/core'
import type { UploadResult } from '@uppy/core'
import Tus from '@uppy/tus'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import { resolveTusEndpoint } from '@/lib/tusd'

import {
  applyUploadStatusEntries,
  buildUploadFailureOverrides,
  resolveUploadFailureTargets,
  summarizeUploadStatusEntries,
  UPLOAD_STATUS_POLL_SCHEDULE_MS,
  type TrackedUpload,
  type UploadModalStatusOverride,
} from '../upload-status-poll'

type UseLibraryUploadsOptions = {
  libraryToasts: (key: string, values?: any, formats?: any) => string
  userId?: string
}

type UploadTokenState = {
  token: string
  expiresAt: number
}

function extractTusUploadId(file: {
  response?: {
    uploadURL?: string
    body?: Record<string, unknown>
  }
}): string | null {
  const candidates = [
    file.response?.body?.upload_id,
    file.response?.body?.id,
    file.response?.uploadURL,
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) {
      continue
    }
    if (!candidate.includes('/')) {
      return candidate.trim()
    }

    try {
      const url = new URL(candidate)
      const parts = url.pathname.split('/').filter(Boolean)
      return parts.at(-1) ?? null
    } catch {
      const parts = candidate.split('/').filter(Boolean)
      return parts.at(-1) ?? null
    }
  }

  return null
}

export const useLibraryUploads = ({
  libraryToasts,
  userId,
}: UseLibraryUploadsOptions) => {
  const queryClient = useQueryClient()
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isProcessingUpload, setIsProcessingUpload] = useState(false)
  const [uploadStatusOverrides, setUploadStatusOverrides] = useState<
    Record<string, UploadModalStatusOverride>
  >({})
  const [uploadTokenState, setUploadTokenState] = useState<UploadTokenState | null>(null)

  const tusEndpoint = useMemo(() => resolveTusEndpoint(process.env.NEXT_PUBLIC_TUSD_URL), [])
  const [uppy] = useState(
    () =>
      new Uppy<Record<string, string>, Record<string, any>>({
        autoProceed: false,
        restrictions: {
          allowedFileTypes: ['video/*', 'audio/*'],
          maxFileSize: 10 * 1024 * 1024 * 1024,
        },
      }),
  )

  const clearUploadStatusOverrides = useCallback(() => {
    setUploadStatusOverrides({})
  }, [])

  const openUploadModal = useCallback(() => {
    setIsUploadOpen(true)
  }, [])

  const closeUploadModal = useCallback(() => {
    setUploadStatusOverrides({})
    setIsProcessingUpload(false)
    setIsUploadOpen(false)
  }, [])

  useEffect(() => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const existingPlugin = uppy.getPlugin('Tus')
    if (existingPlugin) {
      uppy.removePlugin(existingPlugin)
    }

    uppy.use(Tus, {
      endpoint: tusEndpoint,
      chunkSize: 16 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
    })

    const refreshAssetLists = async () => {
      await queryClient.invalidateQueries({ queryKey: ['assets', userId] })
      await queryClient.refetchQueries({ queryKey: ['assets', userId], type: 'active' })
    }

    const handleComplete = async (
      result: UploadResult<Record<string, string>, Record<string, any>>,
    ) => {
      if (!result.successful || !result.successful.length) {
        return
      }
      if (!userId) {
        return
      }

      const successfulUploads = result.successful
      const successfulFileIds = successfulUploads.map((file) => file.id)
      setIsProcessingUpload(true)
      setUploadStatusOverrides((current) => {
        const next = { ...current }
        successfulUploads.forEach((file) => {
          next[file.id] = { status: 'processing' }
        })
        return next
      })
      const toastId = toast.loading(libraryToasts('upload.finalizing'))

      let trackedUploads: TrackedUpload[] = []

      try {
        trackedUploads = successfulUploads.map<TrackedUpload>((file) => {
          const uploadId = extractTusUploadId(file)
          if (!uploadId) {
            throw new Error(`Missing upload id for ${file.name}`)
          }
          return {
            fileId: file.id,
            uploadId,
            name: file.name,
            size: typeof file.size === 'number' ? file.size : undefined,
          }
        })

        let finalizedCount = 0
        let failedCount = 0
        let lastFailureMessage: string | null = null

        for (const delayMs of UPLOAD_STATUS_POLL_SCHEDULE_MS) {
          if (delayMs) {
            await sleep(delayMs)
          }

          const defaultFailureMessage = libraryToasts('upload.failed', {
            message: libraryToasts('generic.unknownError'),
          })
          const statuses = await Promise.all(
            trackedUploads.map(async (upload) => {
              try {
                const ingest = await api.assets.getUploadStatus(upload.uploadId)
                return { upload, ingest }
              } catch (error) {
                if (error instanceof ApiError && error.status === 404) {
                  return null
                }
                throw error
              }
            }),
          )

          const statusSummary = summarizeUploadStatusEntries(statuses, defaultFailureMessage)

          setUploadStatusOverrides((current) =>
            applyUploadStatusEntries(statuses, current, defaultFailureMessage),
          )

          finalizedCount = statusSummary.finalizedCount
          failedCount = statusSummary.failedCount
          lastFailureMessage = statusSummary.failureMessage

          if (statusSummary.pendingCount === 0) {
            break
          }
        }

        if (finalizedCount > 0) {
          await refreshAssetLists()
        }

        if (failedCount > 0) {
          const failureMessage =
            lastFailureMessage ??
            libraryToasts('upload.failed', {
              message: libraryToasts('generic.unknownError'),
            })
          setUploadStatusOverrides((current) =>
            buildUploadFailureOverrides(trackedUploads, current, failureMessage),
          )
          toast.error(failureMessage, { id: toastId })
          return
        }

        if (finalizedCount !== trackedUploads.length) {
          throw new Error(
            libraryToasts('upload.refreshFailed', {
              message: 'Timed out waiting for upload finalization',
            }),
          )
        }

        toast.success(libraryToasts('upload.processed'), { id: toastId })
        setUploadStatusOverrides({})
        setIsUploadOpen(false)
        uppy.cancelAll()
        const fileIds = uppy.getFiles().map((file) => file.id)
        if (fileIds.length) {
          uppy.removeFiles(fileIds)
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : libraryToasts('generic.unknownError')
        const failureTargets = resolveUploadFailureTargets(trackedUploads, successfulFileIds)
        setUploadStatusOverrides((current) =>
          buildUploadFailureOverrides(failureTargets, current, message),
        )
        toast.error(libraryToasts('upload.refreshFailed', { message }), { id: toastId })
      } finally {
        setIsProcessingUpload(false)
      }
    }

    const handleError = (error: Error) => {
      toast.error(libraryToasts('upload.failed', { message: error.message }))
    }

    uppy.on('complete', handleComplete)
    uppy.on('error', handleError)

    return () => {
      uppy.off('complete', handleComplete)
      uppy.off('error', handleError)
      const plugin = uppy.getPlugin('Tus')
      if (plugin) {
        uppy.removePlugin(plugin)
      }
    }
  }, [libraryToasts, queryClient, tusEndpoint, uppy, userId])

  const refreshUploadToken = useCallback(async () => {
    if (!userId) {
      setUploadTokenState(null)
      return
    }

    try {
      const response = await api.assets.createUploadToken()
      const expiresAt = new Date(response.expires_at).getTime()
      setUploadTokenState({ token: response.token, expiresAt })
      uppy.setMeta({ upload_token: response.token })
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : (error as Error)?.message ?? libraryToasts('upload.tokenRefreshFailed')
      toast.error(libraryToasts('generic.errorWithMessage', { message }))
    }
  }, [libraryToasts, uppy, userId])

  useEffect(() => {
    if (!userId) {
      setUploadTokenState(null)
      return
    }
    void refreshUploadToken()
  }, [refreshUploadToken, userId])

  useEffect(() => {
    if (!uploadTokenState || typeof window === 'undefined') {
      return
    }

    const now = Date.now()
    const refreshIn = Math.max(uploadTokenState.expiresAt - now - 60_000, 5_000)
    const timer = window.setTimeout(() => {
      void refreshUploadToken()
    }, refreshIn)

    return () => {
      window.clearTimeout(timer)
    }
  }, [refreshUploadToken, uploadTokenState])

  useEffect(() => {
    if (!userId) {
      return
    }
    const meta: Record<string, string> = { user_id: userId }
    if (uploadTokenState?.token) {
      meta.upload_token = uploadTokenState.token
    }
    uppy.setMeta(meta)
  }, [uppy, uploadTokenState?.token, userId])

  return {
    clearUploadStatusOverrides,
    closeUploadModal,
    isProcessingUpload,
    isUploadOpen,
    openUploadModal,
    uppy,
    uploadStatusEntries: Object.entries(uploadStatusOverrides),
    uploadStatusOverrides,
  }
}
