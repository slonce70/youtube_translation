import {
  buildUploadFailureOverrides,
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
})
