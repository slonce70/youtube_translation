'use client'

import { AlertCircle, CheckCircle, Loader2, X, XCircle } from 'lucide-react'
import type { TranslationValues } from 'next-intl'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import type { Asset } from '@/lib/types'

import {
  formatAssetWarningMessage,
  formatBitrateDisplay,
  formatFpsDisplay,
  formatSampleRateDisplay,
  type AssetDisplayInfo,
} from '../asset-utils'

type AssetValidationModalProps = {
  asset: Asset | null
  closeLabel: string
  incompatibleSummary: string
  info: AssetDisplayInfo | null
  isLoading: boolean
  metadataAudioLabel: string
  metadataChannelsLabel: (count: number) => string
  metadataVideoLabel: string
  onClose: () => void
  readyLabel: string
  recommendationsLabel: (input: { label?: string; details?: string }) => string
  title: string
  unavailableLabel: string
  validationCloseLabel: string
  validationDescription: (filename: string) => string
  validationLoading: string
  warningBitrateCheckLabel: string
  warningBitrateOkLabel: string
  warningNeedsEncodingLabel: string
  tAssetWarnings: (key: string, values?: TranslationValues) => string
}

export function AssetValidationModal({
  asset,
  closeLabel,
  incompatibleSummary,
  info,
  isLoading,
  metadataAudioLabel,
  metadataChannelsLabel,
  metadataVideoLabel,
  onClose,
  readyLabel,
  recommendationsLabel,
  title,
  unavailableLabel,
  validationCloseLabel,
  validationDescription,
  validationLoading,
  warningBitrateCheckLabel,
  warningBitrateOkLabel,
  warningNeedsEncodingLabel,
  tAssetWarnings,
}: AssetValidationModalProps) {
  if (!asset) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
      <Card className="w-full max-w-2xl shadow-2xl">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {validationDescription(asset.filename)}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
              <span className="sr-only">{closeLabel}</span>
            </Button>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500 dark:text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p>{validationLoading}</p>
            </div>
          ) : info ? (
            <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={asset.compatible_for_copy ? 'success' : 'error'}>
                  {asset.compatible_for_copy ? readyLabel : warningNeedsEncodingLabel}
                </Badge>
                {info.bitrateStatus === 'within' ? (
                  <Badge variant="success">{warningBitrateOkLabel}</Badge>
                ) : info.bitrateStatus === 'outside' ? (
                  <Badge variant="warning">{warningBitrateCheckLabel}</Badge>
                ) : null}
              </div>

              {!asset.compatible_for_copy && (
                <div className="text-sm text-error-600 dark:text-error-400">
                  {incompatibleSummary}
                  {info.issues.length > 0 && (
                    <span className="block text-xs text-error-500/90 dark:text-error-300">
                      {info.issues[0]}
                    </span>
                  )}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {metadataVideoLabel}
                  </span>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{info.videoCodec?.toUpperCase() ?? '—'}</Badge>
                    <span>{formatBitrateDisplay(info.videoBitrate)}</span>
                    <span>·</span>
                    <span>
                      {info.videoWidth && info.videoHeight
                        ? `${info.videoWidth}×${info.videoHeight}`
                        : '—'}
                    </span>
                    <span>·</span>
                    <span>{formatFpsDisplay(info.videoFps)}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {metadataAudioLabel}
                  </span>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{info.audioCodec?.toUpperCase() ?? '—'}</Badge>
                    <span>{formatBitrateDisplay(info.audioBitrate)}</span>
                    <span>·</span>
                    <span>{formatSampleRateDisplay(info.audioSampleRate)}</span>
                    {info.audioChannels ? (
                      <>
                        <span>·</span>
                        <span>{metadataChannelsLabel(info.audioChannels)}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {info.recommendationLabel ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <CheckCircle className="w-4 h-4 text-primary-500" />
                  <span>
                    {recommendationsLabel({
                      label: info.recommendationLabel,
                      details: info.recommendationDetails,
                    })}
                  </span>
                </div>
              ) : null}

              {(info.issues.length > 0 || info.warnings.length > 0) && (
                <div className="space-y-2">
                  {info.issues.map((issue, index) => (
                    <div
                      key={`modal-issue-${index}`}
                      className="flex items-start text-sm text-error-600 dark:text-error-400"
                    >
                      <XCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                      <span>{issue}</span>
                    </div>
                  ))}
                  {info.warnings.map((warning, index) => (
                    <div
                      key={`modal-warning-${index}`}
                      className="flex items-start text-sm text-amber-600 dark:text-amber-400"
                    >
                      <AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                      <span>{formatAssetWarningMessage(tAssetWarnings, warning)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {unavailableLabel}
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={onClose}>{validationCloseLabel}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
