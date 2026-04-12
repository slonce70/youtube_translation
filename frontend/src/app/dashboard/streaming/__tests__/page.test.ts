import {
  buildStreamIncidentNotice,
  getStreamLogLineClassName,
  summarizeRuntimeIncidentState,
  summarizeStreamLogIncidents,
} from '@/lib/stream-state'

describe('streaming page incident helpers', () => {
  it('builds a degraded incident notice for running provider-health issues', () => {
    const summary = summarizeRuntimeIncidentState({
      isRunning: true,
      derivedStatus: 'running',
      quotaReached: false,
      runtimeRestart: {
        enabled: true,
        state: 'idle',
        attempts: 0,
        max_attempts: 5,
        next_restart_at: null,
        last_restart_at: null,
        last_failure_at: null,
      },
      providerHealthAttention: true,
      providerHealthIssues: ['gopSizeOver'],
      effectiveErrorMessage: null,
    })

    expect(buildStreamIncidentNotice(summary)).toEqual({
      tone: 'degraded',
      title: 'Провайдер повідомляє про деградацію потоку',
      details: ['Отримано 1 сигнал(и) деградації від destination/provider health.'],
    })
  })

  it('builds a critical notice for unrecovered log incidents', () => {
    const summary = summarizeStreamLogIncidents([
      '2026-04-11T10:00:00Z Connection reset by peer',
      '2026-04-11T10:00:01Z Broken pipe',
    ], {
      nowMs: Date.parse('2026-04-11T10:05:00Z'),
    })

    expect(buildStreamIncidentNotice(summary)).toEqual({
      tone: 'critical',
      title: "RTMPS ingest скинув з'єднання 1 раз(и)",
      details: ['FFmpeg зафіксував Broken pipe 1 раз(и)'],
    })
  })

  it('returns log line colors for audit, transport and recovery lines', () => {
    expect(getStreamLogLineClassName('2026-04-11T10:00:00Z [audit] INFO Stop requested')).toBe('text-amber-200')
    expect(getStreamLogLineClassName('2026-04-11T10:00:00Z Recovery successful')).toBe('text-amber-200')
    expect(getStreamLogLineClassName('2026-04-11T10:00:00Z Connection reset by peer')).toBe('text-error-300')
    expect(getStreamLogLineClassName('2026-04-11T10:00:00Z ok')).toBe('text-slate-300')
  })
})
