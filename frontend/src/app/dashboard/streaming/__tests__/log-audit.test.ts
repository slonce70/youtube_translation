import { extractStopAuditEntries, parseStreamAuditLine } from '../log-audit'

describe('log-audit helpers', () => {
  it('parses audit lines with trailing metadata', () => {
    const entry = parseStreamAuditLine(
      '2026-04-09T18:02:43.724473+00:00 [audit] INFO Stream stopped via verification_probe. {"category":"stream_stop","phase":"completed"}',
    )

    expect(entry).toEqual({
      raw: '2026-04-09T18:02:43.724473+00:00 [audit] INFO Stream stopped via verification_probe. {"category":"stream_stop","phase":"completed"}',
      timestamp: '2026-04-09T18:02:43.724473+00:00',
      level: 'INFO',
      message: 'Stream stopped via verification_probe.',
      metadata: { category: 'stream_stop', phase: 'completed' },
    })
  })

  it('keeps only stop-related audit entries', () => {
    const entries = extractStopAuditEntries([
      '2026-04-09T17:57:45.544972+00:00 [audit] INFO probe event {"category":"probe"}',
      '2026-04-09T18:02:41.403465+00:00 [audit] INFO Stop requested via verification_probe (reason: post_deploy_audit_check). {"category":"stream_stop","phase":"requested"}',
      '2026-04-09T18:02:43.724473+00:00 [audit] INFO Stream stopped via verification_probe (reason: post_deploy_audit_check). {"category":"stream_stop","phase":"completed"}',
    ])

    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.message)).toEqual([
      'Stop requested via verification_probe (reason: post_deploy_audit_check).',
      'Stream stopped via verification_probe (reason: post_deploy_audit_check).',
    ])
  })
})
