import { UPLOAD_STATUS_POLL_SCHEDULE_MS } from '../upload-status-poll'

describe('UPLOAD_STATUS_POLL_SCHEDULE_MS', () => {
  it('waits before the first status lookup so post-finish can create the ingest row', () => {
    expect(UPLOAD_STATUS_POLL_SCHEDULE_MS[0]).toBeGreaterThan(0)
  })

  it('keeps multiple retries for slower backend finalization', () => {
    expect(UPLOAD_STATUS_POLL_SCHEDULE_MS).toHaveLength(7)
    expect(UPLOAD_STATUS_POLL_SCHEDULE_MS.at(-1)).toBeGreaterThanOrEqual(20000)
  })
})
