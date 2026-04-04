export const UPLOAD_STATUS_POLL_SCHEDULE_MS = [
  1200,
  800,
  1600,
  3200,
  6400,
  12000,
  20000,
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
