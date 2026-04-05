export const UPLOAD_STATUS_POLL_SCHEDULE_MS = [
  1200,
  800,
  1600,
  3200,
  6400,
  12000,
  20000,
  30000,
  30000,
  30000,
  30000,
  30000,
] as const

export type UploadModalStatusOverride = {
  status: 'processing' | 'complete' | 'error'
  error?: string
}

export type TrackedUpload = {
  fileId: string
  uploadId: string
  name: string
  size?: number
}

export type UploadStatusEntry = {
  upload: Pick<TrackedUpload, 'fileId'>
  ingest: {
    status: string
    error_message?: string | null
  }
} | null

export type UploadStatusSummary = {
  pendingCount: number
  finalizedCount: number
  failedCount: number
  failureMessage: string | null
}

export function summarizeUploadStatusEntries(
  statuses: UploadStatusEntry[],
  fallbackError: string
): UploadStatusSummary {
  let pendingCount = 0
  let finalizedCount = 0
  let failedCount = 0
  let failureMessage: string | null = null

  statuses.forEach((entry) => {
    if (!entry) {
      pendingCount += 1
      return
    }

    if (entry.ingest.status === 'finalized') {
      finalizedCount += 1
      return
    }

    if (entry.ingest.status === 'failed') {
      failedCount += 1
      failureMessage = failureMessage ?? entry.ingest.error_message ?? fallbackError
      return
    }

    pendingCount += 1
  })

  return {
    pendingCount,
    finalizedCount,
    failedCount,
    failureMessage,
  }
}

export function applyUploadStatusEntries(
  statuses: UploadStatusEntry[],
  current: Record<string, UploadModalStatusOverride>,
  fallbackError: string
): Record<string, UploadModalStatusOverride> {
  const next = { ...current }

  statuses.forEach((entry) => {
    if (!entry) {
      return
    }

    if (entry.ingest.status === 'finalized') {
      next[entry.upload.fileId] = { status: 'complete' }
      return
    }

    if (entry.ingest.status === 'failed') {
      next[entry.upload.fileId] = {
        status: 'error',
        error: entry.ingest.error_message ?? fallbackError,
      }
      return
    }

    next[entry.upload.fileId] = { status: 'processing' }
  })

  return next
}

export function resolveUploadFailureTargets(
  trackedUploads: Pick<TrackedUpload, 'fileId'>[],
  fallbackFileIds: string[]
): Pick<TrackedUpload, 'fileId'>[] {
  if (trackedUploads.length > 0) {
    return trackedUploads
  }

  return fallbackFileIds.map((fileId) => ({ fileId }))
}

export function buildUploadFailureOverrides(
  trackedUploads: Pick<TrackedUpload, 'fileId'>[],
  current: Record<string, UploadModalStatusOverride>,
  error: string
): Record<string, UploadModalStatusOverride> {
  const next = { ...current }

  trackedUploads.forEach(({ fileId }) => {
    const existing = next[fileId]
    if (existing?.status === 'complete' || existing?.status === 'error') {
      return
    }

    next[fileId] = {
      status: 'error',
      error,
    }
  })

  return next
}
