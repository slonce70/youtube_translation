import {
  applyUploadStatusEntries,
  buildUploadFailureOverrides,
  resolveUploadFailureTargets,
  summarizeUploadStatusEntries,
  UPLOAD_STATUS_POLL_SCHEDULE_MS,
} from '../upload-status-poll'

describe('UPLOAD_STATUS_POLL_SCHEDULE_MS', () => {
  it('waits before the first status lookup so post-finish can create the ingest row', () => {
    expect(UPLOAD_STATUS_POLL_SCHEDULE_MS[0]).toBeGreaterThan(0)
  })

  it('keeps multiple retries for slower backend finalization', () => {
    expect(UPLOAD_STATUS_POLL_SCHEDULE_MS).toHaveLength(7)
    expect(UPLOAD_STATUS_POLL_SCHEDULE_MS.at(-1)).toBeGreaterThanOrEqual(20000)
  })

  it('marks pending uploads as errored without overwriting completed ones', () => {
    expect(
      buildUploadFailureOverrides(
        [{ fileId: 'pending' }, { fileId: 'complete' }, { fileId: 'failed' }],
        {
          pending: { status: 'processing' },
          complete: { status: 'complete' },
          failed: { status: 'error', error: 'Backend finalization failed' },
        },
        'Timed out waiting for upload finalization'
      )
    ).toEqual({
      pending: {
        status: 'error',
        error: 'Timed out waiting for upload finalization',
      },
      complete: { status: 'complete' },
      failed: { status: 'error', error: 'Backend finalization failed' },
    })
  })

  it('derives poll counters without relying on state updater side effects', () => {
    expect(
      summarizeUploadStatusEntries(
        [
          { upload: { fileId: 'complete' }, ingest: { status: 'finalized' } },
          { upload: { fileId: 'failed' }, ingest: { status: 'failed', error_message: 'Backend finalization failed' } },
          { upload: { fileId: 'processing' }, ingest: { status: 'processing' } },
          null,
        ],
        'Timed out waiting for upload finalization'
      )
    ).toEqual({
      pendingCount: 2,
      finalizedCount: 1,
      failedCount: 1,
      failureMessage: 'Backend finalization failed',
    })
  })

  it('applies upload status entries with a side-effect-free updater', () => {
    expect(
      applyUploadStatusEntries(
        [
          { upload: { fileId: 'complete' }, ingest: { status: 'finalized' } },
          { upload: { fileId: 'failed' }, ingest: { status: 'failed', error_message: 'Backend finalization failed' } },
          { upload: { fileId: 'processing' }, ingest: { status: 'processing' } },
          null,
        ],
        {},
        'Timed out waiting for upload finalization'
      )
    ).toEqual({
      complete: { status: 'complete' },
      failed: {
        status: 'error',
        error: 'Backend finalization failed',
      },
      processing: { status: 'processing' },
    })
  })

  it('falls back to successful file ids when tracked uploads never finish parsing', () => {
    const failureTargets = resolveUploadFailureTargets([], ['pending'])

    expect(
      buildUploadFailureOverrides(
        failureTargets,
        { pending: { status: 'processing' } },
        'Missing upload id for pending.mp4'
      )
    ).toEqual({
      pending: {
        status: 'error',
        error: 'Missing upload id for pending.mp4',
      },
    })
  })
})
