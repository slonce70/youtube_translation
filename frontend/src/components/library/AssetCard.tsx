'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale } from 'next-intl'
import {
  AlertCircle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  PlayCircle,
  Clock,
  CalendarClock,
  Waves,
  FileImage,
} from 'lucide-react'

import type { Asset } from '@/lib/types'
import { formatBytes, formatDuration } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { AssetActionsMenu } from '@/components/AssetActionsMenu'
import { resolveAssetUrl } from '@/lib/api'
import {
  deriveAssetDisplayInfo,
  formatBitrateDisplay,
  formatFpsDisplay,
  formatSampleRateDisplay,
  type AssetWarning,
} from '@/app/dashboard/library/asset-utils'
import { formatAbsoluteDateTime } from '@/lib/dates'

interface AssetCardProps {
  asset: Asset
  isSelected: boolean
  density?: 'comfortable' | 'compact'
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
      copyMode: string
      optimizeQueued: string
      optimizeFailed: string
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
    previewAlt: (params: { filename: string }) => string
  }
}

const FALLBACK_OPTIMIZATION = {
  status: 'not_requested',
  strategy: null,
  optimized_storage_path: null,
  error: null,
  updated_at: null,
  recommended_strategy: 'copy',
  can_stream_from_source: true,
} as const

export function AssetCard({
  asset,
  isSelected,
  density = 'comfortable',
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
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null)
  const locale = useLocale()
  const info = deriveAssetDisplayInfo(asset)
  const optimization = asset.optimization ?? FALLBACK_OPTIMIZATION
  const uploadedAt = formatAbsoluteDateTime(asset.created_at, locale)
  const isAudioAsset = asset.asset_type === 'audio'
  const isCompact = density === 'compact'
  const previewSizeClass = isCompact ? 'h-12 w-12' : 'h-14 w-14'
  const fileExtension = useMemo(() => {
    if (!asset.filename.includes('.')) return ''
    return asset.filename.split('.').pop()?.toLowerCase() ?? ''
  }, [asset.filename])

  useEffect(() => {
    const resolved = resolveAssetUrl(asset.thumbnail_url)
    if (resolved) {
      setThumbnailSrc(resolved)
      return
    }

    if (asset.asset_type === 'video') {
      setThumbnailSrc(resolveAssetUrl(`/thumbnails/${asset.id}.jpg`))
      return
    }

    setThumbnailSrc(null)
  }, [asset.id, asset.asset_type, asset.thumbnail_url])

  useEffect(() => {
    if (density === 'compact') {
      setIsExpanded(false)
    }
  }, [density])

  const usageBadges = [
    formatUsageLabel('streams', asset.usage?.streams?.length ?? 0),
    formatUsageLabel('collections', asset.usage?.collections?.length ?? 0),
    formatUsageLabel('playlists', asset.usage?.playlists?.length ?? 0),
  ].filter(Boolean) as string[]

  const optimizationBadge =
    optimization.status === 'queued'
      ? { label: t.badges.optimizeQueued, variant: 'warning' as const }
      : optimization.status === 'failed'
        ? { label: t.badges.optimizeFailed, variant: 'error' as const }
        : optimization.status === 'ready' && optimization.strategy === 'copy'
          ? { label: t.badges.copyMode, variant: 'secondary' as const }
          : null

  return (
    <Card
      className={`animate-slide-up transition-all ${isCompact ? 'h-full' : ''} ${
        isSelected
          ? 'ring-2 ring-primary-300 dark:ring-primary-600'
          : 'ring-1 ring-transparent'
      }`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <CardContent className={isCompact ? 'p-2' : 'p-3'}>
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={`${t.selection.checkboxLabel} ${asset.filename}`}
            title={`${t.selection.checkboxLabel} ${asset.filename}`}
            className="mt-2 h-4 w-4 flex-shrink-0 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          />

          <div className={`relative ${previewSizeClass} flex-shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60`}>
            {thumbnailSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailSrc}
                alt={t.previewAlt({ filename: asset.filename })}
                className="h-full w-full object-cover"
                loading="lazy"
                onError={() => setThumbnailSrc(null)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-400">
                {asset.asset_type === 'audio' ? (
                  <Waves className="h-5 w-5" />
                ) : fileExtension && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExtension) ? (
                  <FileImage className="h-5 w-5" />
                ) : (
                  <PlayCircle className="h-5 w-5" />
                )}
              </div>
            )}
            {asset.asset_type === 'audio' && (
              <span className="absolute bottom-0.5 right-0.5 rounded bg-slate-900/85 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                {t.filters.audio}
              </span>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {asset.filename}
                  </h3>
                  {!thumbnailSrc && asset.asset_type === 'audio' && (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[9px] uppercase">
                      {fileExtension || 'audio'}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    <span>{formatBytes(asset.size_bytes)}</span>
                    {asset.duration_seconds && asset.duration_seconds > 0 && (
                      <>
                        <span>•</span>
                        <span>{formatDuration(asset.duration_seconds)}</span>
                      </>
                    )}
                  </div>
                  {!isCompact && (
                    <div className="flex items-center gap-1.5">
                      <CalendarClock className="h-3 w-3" />
                      <span>{uploadedAt}</span>
                    </div>
                  )}
                </div>
              </div>

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

            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge
                variant={asset.compatible_for_copy ? 'success' : 'error'}
                className="px-2 py-0.5 text-[10px]"
              >
                {asset.compatible_for_copy ? (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    {t.badges.ready}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    {t.badges.needsEncoding}
                  </span>
                )}
              </Badge>
              {!isCompact && (info.bitrateStatus === 'within' ? (
                <Badge variant="success" className="px-2 py-0.5 text-[10px]">
                  {t.badges.bitrateOk}
                </Badge>
              ) : info.bitrateStatus === 'outside' ? (
                <Badge variant="warning" className="px-2 py-0.5 text-[10px]">
                  {t.badges.bitrateCheck}
                </Badge>
              ) : null)}
              {optimizationBadge ? (
                <Badge variant={optimizationBadge.variant} className="px-2 py-0.5 text-[10px]">
                  {optimizationBadge.label}
                </Badge>
              ) : null}
              {usageBadges.map((label, index) => (
                <Badge key={`usage-${index}`} variant="secondary" className="px-2 py-0.5 text-[10px]">
                  {label}
                </Badge>
              ))}
            </div>

            {!asset.compatible_for_copy && info.issues.length > 0 && (
              <div className="text-[11px] text-error-600 dark:text-error-400">
                {t.messages.incompatibleSummary}: {info.issues[0]}
              </div>
            )}

            {!isCompact ? (
              <>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-[11px] dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setIsExpanded((prev) => !prev)}
                    className="flex items-center gap-1 text-primary-600 transition-colors hover:text-primary-500 dark:text-primary-400"
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    {isExpanded ? t.details.hide : t.details.show}
                  </button>
                </div>

                {isExpanded && (
                  <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] dark:border-slate-700 dark:bg-slate-800/50">
                    <div className={`grid gap-2 grid-cols-1 ${isAudioAsset ? '' : 'md:grid-cols-2'}`}>
                      {!isAudioAsset && (
                        <div>
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {t.metadata.video}
                          </span>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
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
                      )}

                      <div>
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {t.metadata.audio}
                        </span>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
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

                    {info.recommendationLabel && (
                      <div className="flex items-start gap-1.5 text-slate-500 dark:text-slate-400">
                        <CheckCircle className="h-3 w-3 text-primary-500" />
                        <span>
                          {t.recommendations({
                            label: info.recommendationLabel,
                            details: info.recommendationDetails ?? '',
                          })}
                        </span>
                      </div>
                    )}

                    {(info.issues.length > 0 || info.warnings.length > 0) && (
                      <div className="space-y-1.5">
                        {info.issues.map((issue, index) => (
                          <div key={`issue-${index}`} className="flex items-start text-error-600 dark:text-error-400">
                            <XCircle className="mr-1.5 mt-0.5 h-3 w-3 flex-shrink-0" />
                            <span>{issue}</span>
                          </div>
                        ))}
                        {info.warnings.map((warning, index) => (
                          <div key={`warning-${index}`} className="flex items-start text-amber-600 dark:text-amber-400">
                            <AlertCircle className="mr-1.5 mt-0.5 h-3 w-3 flex-shrink-0" />
                            <span>{formatWarningMessage(warning)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
