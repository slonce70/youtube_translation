'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import {
  AlertCircle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  PlayCircle,
  Clock,
  CalendarClock,
} from 'lucide-react'

import type { Asset } from '@/lib/types'
import { formatBytes, formatDuration } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { AssetActionsMenu } from '@/components/AssetActionsMenu'
import {
  deriveAssetDisplayInfo,
  formatBitrateDisplay,
  formatFpsDisplay,
  formatSampleRateDisplay,
  type AssetWarning,
} from '@/app/dashboard/library/asset-utils'

interface AssetCardProps {
  asset: Asset
  isSelected: boolean
  onSelect: (checked: boolean) => void
  onRename: () => void
  onDelete: () => void
  onCheck: () => void
  onMove: () => void
  onDownload: () => void
  onPlaylistAdd: () => void
  onOptimize: () => void
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  isDeleting?: boolean
  isChecking?: boolean
  isGeneratingDownload?: boolean
  formatWarningMessage: (warning: AssetWarning) => string
  formatUsageLabel: (type: 'streams' | 'collections' | 'playlists', count: number) => string | null
  // i18n
  t: {
    filters: { audio: string }
    badges: {
      ready: string
      needsEncoding: string
      bitrateOk: string
      bitrateCheck: string
    }
    messages: { incompatibleSummary: string }
    details: { hide: string; show: string }
    metadata: {
      video: string
      audio: string
      channels: (count: number) => string
    }
    recommendations: (params: { label: string; details: string }) => string
    selection: { checkboxLabel: string }
  }
}

export function AssetCard({
  asset,
  isSelected,
  onSelect,
  onRename,
  onDelete,
  onCheck,
  onMove,
  onDownload,
  onPlaylistAdd,
  onOptimize,
  onDragStart,
  onDragEnd,
  isDeleting = false,
  isChecking = false,
  isGeneratingDownload = false,
  formatWarningMessage,
  formatUsageLabel,
  t,
}: AssetCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const info = deriveAssetDisplayInfo(asset)
  const uploadedAt = format(new Date(asset.created_at), 'MMM d, yyyy • HH:mm')
  const thumbnailUrl = asset.thumbnail_url

  const usageBadges = [
    formatUsageLabel('streams', asset.usage?.streams?.length ?? 0),
    formatUsageLabel('collections', asset.usage?.collections?.length ?? 0),
    formatUsageLabel('playlists', asset.usage?.playlists?.length ?? 0),
  ].filter(Boolean) as string[]

  return (
    <Card
      className={`animate-slide-up transition-all ${
        isSelected
          ? 'ring-2 ring-primary-300 dark:ring-primary-600'
          : 'ring-1 ring-transparent'
      }`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header Row: Checkbox, Thumbnail, Title, Actions */}
        <div className="flex items-start gap-3">
          {/* Checkbox */}
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={`${t.selection.checkboxLabel} ${asset.filename}`}
            title={`${t.selection.checkboxLabel} ${asset.filename}`}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 flex-shrink-0"
          />

          {/* Compact square thumbnail */}
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50">
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl}
                alt={`Preview of ${asset.filename}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-400">
                <PlayCircle className="h-5 w-5" />
              </div>
            )}
            {asset.asset_type === 'audio' && (
              <span className="absolute bottom-0.5 right-0.5 rounded bg-slate-900/80 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                {t.filters.audio}
              </span>
            )}
          </div>

          {/* Title and metadata */}
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate mb-1">
              {asset.filename}
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                <span>{formatBytes(asset.size_bytes)}</span>
                {asset.duration_seconds && (
                  <>
                    <span>•</span>
                    <span>{formatDuration(asset.duration_seconds)}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <CalendarClock className="w-3 h-3" />
                <span>{uploadedAt}</span>
              </div>
            </div>
          </div>

          {/* Actions Menu */}
          <AssetActionsMenu
            onEdit={onRename}
            onDelete={onDelete}
            onCheck={onCheck}
            onPlaylists={onPlaylistAdd}
            onOptimize={onOptimize}
            onMove={onMove}
            onDownload={onDownload}
            isDeleting={isDeleting}
            isChecking={isChecking}
            isGeneratingDownload={isGeneratingDownload}
          />
        </div>

        {/* Compact badges row */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant={asset.compatible_for_copy ? 'success' : 'error'}
            className="text-xs py-0.5"
          >
            {asset.compatible_for_copy ? (
              <>
                <CheckCircle className="w-2.5 h-2.5 mr-1" />
                {t.badges.ready}
              </>
            ) : (
              <>
                <XCircle className="w-2.5 h-2.5 mr-1" />
                {t.badges.needsEncoding}
              </>
            )}
          </Badge>
          {info.bitrateStatus === 'within' ? (
            <Badge variant="success" className="text-xs py-0.5">
              {t.badges.bitrateOk}
            </Badge>
          ) : info.bitrateStatus === 'outside' ? (
            <Badge variant="warning" className="text-xs py-0.5">
              {t.badges.bitrateCheck}
            </Badge>
          ) : null}
          {usageBadges.map((label, index) => (
            <Badge key={`usage-${index}`} variant="secondary" className="text-xs py-0.5">
              {label}
            </Badge>
          ))}
        </div>

        {/* Incompatible warning (compact) */}
        {!asset.compatible_for_copy && info.issues.length > 0 && (
          <div className="text-xs text-error-600 dark:text-error-400">
            {t.messages.incompatibleSummary}: {info.issues[0]}
          </div>
        )}

        {/* Details toggle */}
        <div className="flex items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-xs font-medium text-primary-600 transition-colors hover:text-primary-500 dark:text-primary-400"
          >
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {isExpanded ? t.details.hide : t.details.show}
          </button>
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
            <div className="grid gap-2 md:grid-cols-2">
              {/* Video metadata */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t.metadata.video}
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="text-[10px] py-0">
                    {info.videoCodec?.toUpperCase() ?? '—'}
                  </Badge>
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

              {/* Audio metadata */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t.metadata.audio}
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="text-[10px] py-0">
                    {info.audioCodec?.toUpperCase() ?? '—'}
                  </Badge>
                  <span>{formatBitrateDisplay(info.audioBitrate)}</span>
                  <span>·</span>
                  <span>{formatSampleRateDisplay(info.audioSampleRate)}</span>
                  {info.audioChannels && (
                    <>
                      <span>·</span>
                      <span>{t.metadata.channels(info.audioChannels)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Recommendation */}
            {info.recommendationLabel && (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                <CheckCircle className="w-3 h-3 text-primary-500 flex-shrink-0" />
                <span>
                  {t.recommendations({
                    label: info.recommendationLabel,
                    details: info.recommendationDetails ?? '',
                  })}
                </span>
              </div>
            )}

            {/* Issues and warnings */}
            {(info.issues.length > 0 || info.warnings.length > 0) && (
              <div className="space-y-1.5">
                {info.issues.map((issue, index) => (
                  <div
                    key={`issue-${index}`}
                    className="flex items-start text-xs text-error-600 dark:text-error-400"
                  >
                    <XCircle className="w-3 h-3 mr-1.5 mt-0.5 flex-shrink-0" />
                    <span>{issue}</span>
                  </div>
                ))}
                {info.warnings.map((warning, index) => (
                  <div
                    key={`warning-${index}`}
                    className="flex items-start text-xs text-amber-600 dark:text-amber-400"
                  >
                    <AlertCircle className="w-3 h-3 mr-1.5 mt-0.5 flex-shrink-0" />
                    <span>{formatWarningMessage(warning)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
