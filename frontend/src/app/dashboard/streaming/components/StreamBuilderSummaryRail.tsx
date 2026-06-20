import type { TranslationValues } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import type { Asset, Destination, Stream } from '@/lib/types'

import type { CollectionEditorState, ScheduleState } from '../builder-helpers'
import type { StreamFormState } from '../hooks/useStreamBuilder'

type Translator = (key: string, values?: TranslationValues) => string

type StreamBuilderSummaryRailProps = {
  builder: Translator
  selectedDestinations: Destination[]
  videoEditor: CollectionEditorState
  assetMap: Map<string, Asset>
  scheduleState: ScheduleState
  startAtLabel: string | null
  hasVideoSelection: boolean
  streamForm: StreamFormState
  runningStreams: Stream[]
  concurrentStreamsLimit: number | null
  formatLimitValue: (value?: number | null) => string
  canLaunch: boolean
  handleBuilderSubmit: () => void
  isBuilderSubmitting: boolean
  createPending: boolean
}

export function StreamBuilderSummaryRail({
  builder,
  selectedDestinations,
  videoEditor,
  assetMap,
  scheduleState,
  startAtLabel,
  hasVideoSelection,
  streamForm,
  runningStreams,
  concurrentStreamsLimit,
  formatLimitValue,
  canLaunch,
  handleBuilderSubmit,
  isBuilderSubmitting,
  createPending,
}: StreamBuilderSummaryRailProps) {
  return (
    <div
      className="sticky-summary lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto"
      style={{ width: '100%', maxWidth: 340 }}
    >
      <Card className="summary-card" style={{ borderColor: 'rgba(99,102,241,.3)' }}>
        <CardHeader>
          <CardTitle>{builder('summaryTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="summary-list" style={{ fontSize: 13 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 80, color: 'var(--txt-3)' }}>{builder('summaryChannel')}</span>
            <span>{selectedDestinations[0]?.name ?? builder('summaryNotChosen')}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 80, color: 'var(--txt-3)' }}>{builder('summaryFile')}</span>
            <span>
              {videoEditor.items[0]
                ? (assetMap.get(videoEditor.items[0].asset_id)?.filename ?? builder('fallbackDuration'))
                : builder('summaryNotChosen')}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 80, color: 'var(--txt-3)' }}>{builder('summaryDuration')}</span>
            <span>{videoEditor.items[0] ? builder('summaryDependsOnSource') : builder('fallbackDuration')}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 80, color: 'var(--txt-3)' }}>{builder('summaryStart')}</span>
            <span>
              {scheduleState.startMode === 'now'
                ? builder('summaryStartImmediate')
                : (startAtLabel ?? builder('summaryStartScheduled'))}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="card-sm">
        <CardTitle>{builder('readyTitle')}</CardTitle>
        <CardContent className="summary-list" style={{ marginTop: 10 }}>
          <div style={{ color: selectedDestinations.length ? 'var(--green)' : 'var(--red)' }}>
            {selectedDestinations.length ? '✓' : '✗'} {builder('readyChannel')}
          </div>
          <div style={{ color: hasVideoSelection ? 'var(--green)' : 'var(--red)' }}>
            {hasVideoSelection ? '✓' : '✗'} {builder('readyFile')}
          </div>
          <div style={{ color: streamForm.name.trim() ? 'var(--green)' : 'var(--red)' }}>
            {streamForm.name.trim() ? '✓' : '✗'} {builder('readyName')}
          </div>
          <div style={{ color: 'var(--green)' }}>
            {'✓ '}
            {builder('readyLimit', {
              used: runningStreams.length,
              limit: formatLimitValue(concurrentStreamsLimit),
            })}
          </div>
        </CardContent>
      </Card>

      <div
        className="info-box"
        style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', padding: 14 }}
      >
        <div style={{ fontSize: 12, color: 'var(--indigo-lt)', fontWeight: 600, marginBottom: 6 }}>
          {builder('howItWorks')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt-2)', lineHeight: 1.6 }}>
          {builder('howItWorksBody')}
        </div>
      </div>

      <Button
        fullWidth
        variant="success"
        size="lg"
        disabled={!canLaunch}
        onClick={handleBuilderSubmit}
        isLoading={isBuilderSubmitting || createPending}
      >
        {builder('launch')}
      </Button>
    </div>
  )
}
