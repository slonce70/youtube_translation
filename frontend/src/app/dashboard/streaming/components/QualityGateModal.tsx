'use client'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import type { QuotaUsageResponse } from '@/lib/types'

import type { QualityGateState, QualityViolationGroup } from '../hooks/useQualityGate'

type Translator = (key: string, values?: Record<string, unknown>) => string

type QualityGateModalProps = {
  state: QualityGateState
  groupedViolations: QualityViolationGroup[]
  activePlanLabel: string
  planQualityLimits?: QuotaUsageResponse['quality']
  t: Translator
  onClose: () => void
  onGoToLibrary: () => void
}

const violationTranslationKey: Record<string, string> = {
  resolution_exceeded: 'streams.quality.violations.resolution',
  fps_exceeded: 'streams.quality.violations.fps',
  fps_out_of_range: 'streams.quality.violations.fpsRange',
  bitrate_out_of_range: 'streams.quality.violations.bitrateRange',
  bitrate_missing: 'streams.quality.violations.bitrateMissing',
  guideline_missing: 'streams.quality.violations.guidelineMissing',
  missing_metadata: 'streams.quality.violations.missingMetadata',
}

export function QualityGateModal({
  state,
  groupedViolations,
  activePlanLabel,
  planQualityLimits,
  t,
  onClose,
  onGoToLibrary,
}: QualityGateModalProps) {
  if (!state) {
    return null
  }

  const { quality, streamName } = state
  const recommended = quality.recommended

  const resolution = (() => {
    if (recommended?.resolution) {
      return recommended.resolution
    }
    if (quality.limits.max_resolution_height) {
      return `${quality.limits.max_resolution_height}p`
    }
    if (planQualityLimits?.max_resolution) {
      return planQualityLimits.max_resolution
    }
    return t('streams.quality.limits.unlimited')
  })()

  const fpsLimit =
    recommended?.fps ??
    quality.limits.max_fps ??
    planQualityLimits?.max_fps ??
    null
  const fpsDisplay = fpsLimit != null ? fpsLimit.toString() : '∞'

  const minBitrate =
    recommended?.min_bitrate_mbps ??
    quality.limits.min_video_bitrate_mbps ??
    null
  const maxBitrate =
    recommended?.max_bitrate_mbps ??
    quality.limits.max_video_bitrate_mbps ??
    null
  const targetBitrate = recommended?.target_bitrate_mbps ?? null

  const formatValue = (value: number | null) => {
    if (value == null) return null
    const trimmed = value.toFixed(2).replace(/\.00$/, '')
    return trimmed
  }

  const rangeText = (() => {
    const min = formatValue(minBitrate)
    const max = formatValue(maxBitrate)

    if (min && max) return `${min}–${max} Mbps`
    if (min) return `≥ ${min} Mbps`
    if (max) return `≤ ${max} Mbps`
    return t('streams.quality.limits.unlimited')
  })()

  const targetClause = targetBitrate != null
    ? t('streams.quality.recommended.targetClause', {
        target: formatValue(targetBitrate) ?? '—',
      })
    : ''

  const videoCodec = recommended?.video_codec ?? 'H.264'
  const audioCodec = recommended?.audio_codec ?? 'AAC'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
      <Card className="w-full max-w-2xl animate-scale-in">
        <CardHeader>
          <CardTitle>{t('streams.quality.title')}</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('streams.quality.description', {
              name: streamName || t('streams.untitled'),
            })}
          </p>
          <Badge variant="info" className="w-max mt-2 text-xs font-medium">
            {t('streams.quality.plan', { plan: activePlanLabel })}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('streams.quality.limits.resolution')}
              </p>
              <p className="text-base font-semibold text-slate-900 dark:text-white">
                {quality.limits.max_resolution_height
                  ? `${quality.limits.max_resolution_height}p`
                  : t('streams.quality.limits.unlimited')}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('streams.quality.limits.fps')}
              </p>
              <p className="text-base font-semibold text-slate-900 dark:text-white">
                {quality.limits.max_fps ?? t('streams.quality.limits.unlimited')}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('streams.quality.limits.bitrate')}
              </p>
              <p className="text-base font-semibold text-slate-900 dark:text-white">
                {quality.limits.max_video_bitrate_mbps
                  ? `${quality.limits.max_video_bitrate_mbps} Mbps`
                  : t('streams.quality.limits.unlimited')}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-primary-200 dark:border-primary-700/60 bg-primary-50/60 dark:bg-primary-900/30 p-4">
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
              {t('streams.quality.recommended.title')}
            </p>
            <p className="text-sm text-primary-700 dark:text-primary-300 mt-1">
              {t('streams.quality.recommended.description', {
                resolution,
                fps: fpsDisplay,
                videoCodec,
                audioCodec,
                bitrateRange: rangeText,
                targetClause,
              })}
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('streams.quality.detailsHeading')}
            </h4>
            <div className="space-y-3">
              {groupedViolations.map((group) => (
                <div
                  key={group.assetKey}
                  className="rounded-lg border border-error-200 dark:border-error-700 bg-error-50/80 dark:bg-error-900/20 p-3"
                >
                  <p className="text-sm font-semibold text-error-700 dark:text-error-300">
                    {group.filename ??
                      t('streams.quality.unknownAsset', { index: group.position + 1 })}
                  </p>

                  <div className="mt-2 space-y-2">
                    {group.issues.map(({ violation }, issueIndex) => {
                      const messageKey =
                        violationTranslationKey[violation.code ?? ''] ??
                        'streams.quality.violations.default'

                      return (
                        <div key={`${group.assetKey}-${violation.code ?? issueIndex}`}>
                          <p className="text-sm text-error-700 dark:text-error-300">
                            {t(messageKey as any, {
                              current: violation.current ?? '—',
                              allowed: violation.allowed ?? '—',
                            })}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
        <div className="flex justify-end gap-3 px-6 pb-6">
          <Button variant="secondary" onClick={onClose}>
            {t('streams.quality.cta.close')}
          </Button>
          <Button
            onClick={() => {
              onClose()
              onGoToLibrary()
            }}
          >
            {t('streams.quality.cta.library')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
