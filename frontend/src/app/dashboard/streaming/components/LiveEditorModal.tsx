'use client'

import { useState } from 'react'
import type { TranslationValues } from 'next-intl'
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState } from '@/components/LoadingState'
import { cn } from '@/lib/utils'
import type { Asset, Destination, Stream } from '@/lib/types'

import type { CollectionEditorState } from '../builder-helpers'
import { applyDurationPreset, DURATION_PRESETS, type ScheduleDraft } from '../schedule-utils'

type Translator = (key: string, values?: TranslationValues) => string

type LiveEditorModalProps = {
  stream: Stream | null
  isLoading: boolean
  applying: boolean
  canApply: boolean
  queueing: { video: string | null; audio: string | null }
  state: { video: CollectionEditorState | null; audio: CollectionEditorState | null }
  assetMap: Map<string, Asset>
  videoAssets: Asset[]
  audioAssets: Asset[]
  onClose: () => void
  onApply: () => void | Promise<void>
  scheduleDraft?: ScheduleDraft | null
  onScheduleChange?: (draft: ScheduleDraft) => void
  nameDraft?: string
  onNameChange?: (name: string) => void
  destinations?: Destination[]
  selectedDestinationIds?: string[]
  onDestinationToggle?: (destinationId: string) => void
  onAddAsset: (target: 'video' | 'audio', assetId: string) => void | Promise<void>
  onRemoveItem: (target: 'video' | 'audio', index: number) => void
  onMoveItem: (target: 'video' | 'audio', from: number, to: number) => void
  onToggleOption: (target: 'video' | 'audio', option: 'loop' | 'shuffle') => void
  t: Translator
}

type EditorPanelProps = {
  target: 'video' | 'audio'
  editor: CollectionEditorState | null
  assets: Asset[]
  assetMap: Map<string, Asset>
  onAddAsset: (target: 'video' | 'audio', assetId: string) => void | Promise<void>
  onRemoveItem: (target: 'video' | 'audio', index: number) => void
  onMoveItem: (target: 'video' | 'audio', from: number, to: number) => void
  onToggleOption: (target: 'video' | 'audio', option: 'loop' | 'shuffle') => void
  queueingAssetId: string | null
  t: Translator
}

const EditorPanel = ({
  target,
  editor,
  assets,
  assetMap,
  onAddAsset,
  onRemoveItem,
  onMoveItem,
  onToggleOption,
  queueingAssetId,
  t,
}: EditorPanelProps) => {
  if (!editor) {
    const titleKey = target === 'video' ? 'streams.liveEdit.videoTitle' : 'streams.liveEdit.audioTitle'
    return (
      <div className="rounded-xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
        <h4 className="font-semibold text-slate-900 dark:text-white">{t(titleKey)}</h4>
        <p className="mt-2">{t('streams.liveEdit.missing')}</p>
      </div>
    )
  }

  const titleKey = target === 'video' ? 'streams.liveEdit.videoTitle' : 'streams.liveEdit.audioTitle'
  const toggleLoopLabel = target === 'video' ? 'streams.liveEdit.toggleLoop' : 'streams.liveEdit.toggleLoop'
  const toggleShuffleLabel = target === 'video' ? 'streams.liveEdit.toggleShuffle' : 'streams.liveEdit.toggleShuffle'

  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/70 flex flex-col space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-semibold text-slate-900 dark:text-white">{t(titleKey)}</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('streams.liveEdit.queueHeading')}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={editor.loop}
              onChange={() => onToggleOption(target, 'loop')}
            />
            {t(toggleLoopLabel)}
          </label>
          <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={editor.shuffle}
              onChange={() => onToggleOption(target, 'shuffle')}
            />
            {t(toggleShuffleLabel)}
          </label>
        </div>
      </div>

      <div className="space-y-2">
        {editor.items.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('streams.liveEdit.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {editor.items.map((item, index) => {
              const asset = assetMap.get(item.asset_id)
              return (
                <li
                  key={`${item.asset_id}-${index}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
                >
                  <div className="flex items-center gap-3">
                    <GripVertical className="w-4 h-4 text-slate-400" />
                    <div>
                      <button
                        type="button"
                        disabled
                        className="font-medium text-slate-900 disabled:cursor-not-allowed disabled:opacity-100 dark:text-white"
                      >
                        {asset?.filename ??
                          (target === 'video'
                            ? t('streams.builder.video.unknownAsset')
                            : t('streams.builder.audio.unknownAsset'))}
                      </button>
                      <p className="text-xs text-slate-500 dark:text-slate-400">#{index + 1}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => onMoveItem(target, index, index - 1)}
                      disabled={index === 0}
                    >
                      <ChevronUp className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => onMoveItem(target, index, index + 1)}
                      disabled={index === editor.items.length - 1}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => onRemoveItem(target, index)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('streams.liveEdit.availableHeading')}
        </p>
        <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
          {assets.length > 0 ? (
            assets.map((asset) => {
              const alreadySelected = editor.items.some((item) => item.asset_id === asset.id)
              const isQueueing = queueingAssetId === asset.id
              const queueingBusy = queueingAssetId !== null
              if (alreadySelected) {
                return (
                  <div
                    key={asset.id}
                    className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-left text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{asset.filename}</span>
                      <span className="text-[11px] uppercase tracking-wide">{t('streams.liveEdit.queued')}</span>
                    </div>
                  </div>
                )
              }
              return (
                <button
                  type="button"
                  key={asset.id}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    queueingBusy
                      ? 'cursor-not-allowed opacity-50'
                      : 'cursor-pointer',
                    'border-slate-200 hover:border-primary-500 hover:text-primary-600 dark:border-slate-700',
                  )}
                  disabled={queueingBusy}
                  onClick={() => onAddAsset(target, asset.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{asset.filename}</span>
                    {isQueueing && (
                      <span className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t('streams.liveEdit.queueing')}
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('streams.liveEdit.availableEmpty')}
            </p>
          )}
        </div>
      </div>

    </div>
  )
}

export function LiveEditorModal({
  stream,
  isLoading,
  applying,
  canApply,
  queueing,
  state,
  assetMap,
  videoAssets,
  audioAssets,
  onClose,
  onApply,
  onAddAsset,
  onRemoveItem,
  onMoveItem,
  onToggleOption,
  scheduleDraft,
  onScheduleChange,
  nameDraft,
  onNameChange,
  destinations,
  selectedDestinationIds,
  onDestinationToggle,
  t,
}: LiveEditorModalProps) {
  const [confirming, setConfirming] = useState(false)

  if (!stream) {
    return null
  }

  const handleConfirm = async () => {
    setConfirming(false)
    await onApply()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/70 px-4 py-6 backdrop-blur-sm">
      <Card className="w-full max-w-5xl max-h-[calc(100vh-3rem)] overflow-y-auto animate-scale-in">
        <CardHeader className="flex items-start justify-between space-y-0">
          <div>
            <CardTitle>
              {t('streams.liveEdit.title', {
                name: stream.name || t('streams.untitled'),
              })}
            </CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('streams.liveEdit.subtitle')}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <LoadingState text={t('streams.liveEdit.loading')} />
          ) : (
            <div className="space-y-6">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('streams.liveEdit.restartNotice')}
              </p>
              {(onNameChange || onDestinationToggle) ? (
                <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/70 space-y-4">
                  {onNameChange ? (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {t('streams.form.nameLabel')}
                      </label>
                      <Input
                        value={nameDraft ?? ''}
                        onChange={(event) => onNameChange(event.target.value)}
                        placeholder={t('streams.form.namePlaceholder')}
                        disabled={applying}
                      />
                    </div>
                  ) : null}
                  {onDestinationToggle && destinations ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {t('streams.builder.destinations.title')}
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {destinations.map((destination) => {
                          const selected = selectedDestinationIds?.includes(destination.id) ?? false
                          return (
                            <button
                              key={destination.id}
                              type="button"
                              className={`channel-row${selected ? ' active' : ''}`}
                              onClick={() => onDestinationToggle(destination.id)}
                              disabled={applying}
                            >
                              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{destination.name}</div>
                                <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>{destination.rtmps_url}</div>
                              </div>
                              <span className={`toggle${selected ? ' on' : ''}`} />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <EditorPanel
                  target="video"
                  editor={state.video}
                  assets={videoAssets}
                  assetMap={assetMap}
                  onAddAsset={onAddAsset}
                  onRemoveItem={onRemoveItem}
                  onMoveItem={onMoveItem}
                  onToggleOption={onToggleOption}
                  t={t}
              queueingAssetId={queueing.video}
                />
                {stream.audio_collection_id ? (
                  <EditorPanel
                    target="audio"
                    editor={state.audio}
                    assets={audioAssets}
                    assetMap={assetMap}
                    onAddAsset={onAddAsset}
                    onRemoveItem={onRemoveItem}
                    onMoveItem={onMoveItem}
                    onToggleOption={onToggleOption}
                    t={t}
                queueingAssetId={queueing.audio}
                  />
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
                    <h4 className="font-semibold text-slate-900 dark:text-white">
                      {t('streams.liveEdit.audioTitle')}
                    </h4>
                    <p className="mt-2">{t('streams.liveEdit.disabledAudio')}</p>
                  </div>
                )}
              </div>

              {scheduleDraft && onScheduleChange ? (
                <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/70 space-y-4">
                  <div>
                    <h4 className="font-semibold text-slate-900 dark:text-white">{t('streams.builder.schedule.title')}</h4>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('streams.scheduleModal.description')}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={scheduleDraft.startMode === 'now' ? 'primary' : 'secondary'}
                        onClick={() => onScheduleChange({ ...scheduleDraft, startMode: 'now', startAt: '' })}
                        disabled={applying}
                      >
                        {t('streams.builder.schedule.startNow')}
                      </Button>
                      <Button
                        size="sm"
                        variant={scheduleDraft.startMode === 'schedule' ? 'primary' : 'secondary'}
                        onClick={() => onScheduleChange({ ...scheduleDraft, startMode: 'schedule' })}
                        disabled={applying}
                      >
                        {t('streams.builder.schedule.startLater')}
                      </Button>
                    </div>
                    {scheduleDraft.startMode === 'schedule' ? (
                      <Input
                        type="datetime-local"
                        value={scheduleDraft.startAt}
                        onChange={(event) => onScheduleChange({ ...scheduleDraft, startAt: event.target.value })}
                        disabled={applying}
                      />
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {t('streams.builder.schedule.stopLabel')}
                    </label>
                    <Input
                      type="datetime-local"
                      value={scheduleDraft.stopAt}
                      onChange={(event) => onScheduleChange({ ...scheduleDraft, stopAt: event.target.value })}
                      disabled={applying}
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('streams.builder.schedule.stopHint')}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {DURATION_PRESETS.map((hours) => (
                        <Button
                          key={`live-editor-duration-${hours}`}
                          size="sm"
                          variant="outline"
                          onClick={() => onScheduleChange({ ...scheduleDraft, ...applyDurationPreset(scheduleDraft, hours) })}
                          disabled={applying}
                        >
                          {t(`streams.builder.schedule.durationOptions.${hours}h`)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t('streams.liveEdit.reorderHint')}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {t('streams.liveEdit.actions.close')}
              </Button>
              <Button
                onClick={() => setConfirming(true)}
                disabled={!canApply || applying}
                isLoading={applying}
              >
                {t('streams.liveEdit.actions.apply')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {confirming && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 px-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>{t('streams.liveEdit.confirmation.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('streams.liveEdit.confirmation.description')}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirming(false)}>
                  {t('streams.liveEdit.confirmation.cancel')}
                </Button>
                <Button onClick={handleConfirm} disabled={applying}>
                  {t('streams.liveEdit.confirmation.confirm')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
