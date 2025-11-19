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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { LoadingState } from '@/components/LoadingState'
import { cn } from '@/lib/utils'
import type { Asset, Stream } from '@/lib/types'

import type { CollectionEditorState } from '../builder-helpers'

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
                      <p className="font-medium text-slate-900 dark:text-white">
                        {asset?.filename ??
                          (target === 'video'
                            ? t('streams.builder.video.unknownAsset')
                            : t('streams.builder.audio.unknownAsset'))}
                      </p>
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
              return (
                <button
                  key={asset.id}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    queueingBusy
                      ? 'cursor-not-allowed opacity-50'
                      : 'cursor-pointer',
                    alreadySelected
                      ? 'border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800'
                      : 'border-slate-200 hover:border-primary-500 hover:text-primary-600 dark:border-slate-700',
                  )}
                  disabled={alreadySelected || queueingBusy}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
      <Card className="w-full max-w-5xl animate-scale-in">
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
