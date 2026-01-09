'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { TranslationValues } from 'next-intl'
import {
  AlertTriangle,
  Clock3,
  GripVertical,
  Info,
  Layers,
  MapPin,
  Music3,
  Repeat,
  Shuffle,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Input } from '@/components/ui/Input'
import { LoadingState } from '@/components/LoadingState'
import { cn } from '@/lib/utils'
import { TimelineEditor } from './Timeline/TimelineEditor'
import type {
  Asset,
  Destination,
  MediaCollection,
  QuotaUsageResponse,
  Stream,
} from '@/lib/types'

import { useStreamBuilder } from '../hooks/useStreamBuilder'

type Translator = (key: string, values?: TranslationValues) => string

type StreamBuilderModalProps = {
  open: boolean
  onClose: () => void
  onOpenChannelForm: () => void
  destinations?: Destination[]
  isLoadingDestinations: boolean
  assets?: Asset[]
  isLoadingAssets: boolean
  videoCollections?: MediaCollection[]
  isLoadingVideoCollections: boolean
  audioCollections?: MediaCollection[]
  isLoadingAudioCollections: boolean
  quota?: QuotaUsageResponse
  streams?: Stream[]
  t: Translator
  streamingToasts: Translator
  formatLimitValue: (value?: number | null) => string
}

export function StreamBuilderModal({
  open,
  onClose,
  onOpenChannelForm,
  destinations,
  isLoadingDestinations,
  assets,
  isLoadingAssets,
  videoCollections,
  isLoadingVideoCollections,
  audioCollections,
  isLoadingAudioCollections,
  quota,
  streams,
  t,
  streamingToasts,
  formatLimitValue,
}: StreamBuilderModalProps) {
  const actionLabels = useTranslations('common.actions')
  const localTimezone =
    typeof Intl === 'undefined'
      ? null
      : (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || null
          } catch {
            return null
          }
        })()
  const {
    streamForm,
    setStreamForm,
    activeBuilderTab,
    setActiveBuilderTab,
    builderTabsList,
    currentTabIndex,
    isFinalTab,
    audioEnabled,
    videoEditor,
    audioEditor,
    scheduleState,
    setScheduleState,
    addAssetToEditor,
    removeAssetFromEditor,
    handleItemDragStart,
    handleItemDrop,
    handleSelectCollection,
    handleCustomizeExisting,
    handleDestinationToggle,
    handleAudioToggle,
    handleBuilderSubmit,
    isBuilderSubmitting,
    createPending,
    videoAssets,
    audioAssets,
    assetMap,
    destinations: destinationsState,
    resetBuilderState,
    runningStreams,
    errorStreams,
    concurrentStreamsLimit,
    updateEditor,
    reorderEditorItems,
  } = useStreamBuilder({
    destinations,
    assets,
    videoCollections,
    audioCollections,
    streams,
    quota,
    tStreaming: t,
    streamingToasts,
    onCreated: onClose,
  })

  useEffect(() => {
    if (!open) {
      resetBuilderState()
    }
  }, [open, resetBuilderState])

  if (!open) {
    return null
  }

  const handleClose = () => {
    resetBuilderState()
    onClose()
  }

  const destinationsList = destinationsState ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
      <Card className="w-full max-w-5xl animate-scale-in">
        <CardHeader className="flex items-start justify-between space-y-0">
          <div>
            <CardTitle>{t('streams.form.title')}</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('streams.builder.subtitle')}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose} aria-label={actionLabels('close')}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/70">
              <div className="flex items-center gap-3">
                <Info className="h-5 w-5 text-primary-500" />
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {t('streams.builder.info.capacity')}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {t('streams.builder.info.capacityDescription', {
                      count: runningStreams.length,
                      limit: formatLimitValue(concurrentStreamsLimit),
                    })}
                  </p>
                </div>
              </div>
            </div>
            {errorStreams.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-400/60 dark:bg-amber-500/10">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-300" />
                  <div>
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-200">
                      {t('streams.builder.info.alert')}
                    </p>
                    <p className="text-xs text-amber-700/80 dark:text-amber-200/80">
                      {t('streams.builder.info.alertDescription', { count: errorStreams.length })}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Tabs value={activeBuilderTab} onValueChange={(value) => setActiveBuilderTab(value as typeof activeBuilderTab)}>
            <TabsList className="grid grid-cols-5">
              <TabsTrigger value="video" className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                {t('streams.builder.tabs.video')}
              </TabsTrigger>
              <TabsTrigger value="audio" className="flex items-center gap-2">
                <Music3 className="h-4 w-4" />
                {t('streams.builder.tabs.audio')}
              </TabsTrigger>
              <TabsTrigger value="timeline" className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                {/* eslint-disable-next-line i18next/no-literal-string */}
                Timeline
              </TabsTrigger>
              <TabsTrigger value="destinations" className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {t('streams.builder.tabs.destinations')}
              </TabsTrigger>
              <TabsTrigger value="schedule" className="flex items-center gap-2">
                <Clock3 className="h-4 w-4" />
                {t('streams.builder.tabs.schedule')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="video" className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('streams.builder.video.collectionLabel')}
                </label>
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <select
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                    value={isLoadingVideoCollections ? 'loading' : videoEditor.selectedCollectionId ?? 'custom'}
                    disabled={isLoadingVideoCollections}
                    onChange={(event) => handleSelectCollection('video', event.target.value as string)}
                  >
                    <option value="custom">{t('streams.builder.video.collectionPlaceholder')}</option>
                    {isLoadingVideoCollections ? (
                      <option value="loading" disabled>
                        {t('loading')}
                      </option>
                    ) : (
                      (videoCollections ?? []).map((collection) => (
                        <option key={collection.id} value={collection.id}>
                          {collection.name}
                        </option>
                      ))
                    )}
                  </select>
                  {videoEditor.mode === 'existing' && (
                    <Button variant="outline" size="sm" onClick={() => handleCustomizeExisting('video')}>
                      {t('streams.builder.video.customize')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={videoEditor.loop ? 'primary' : 'secondary'}
                  onClick={() => updateEditor('video', (prev) => ({ ...prev, loop: !prev.loop, mode: 'custom' }))}
                >
                  <Repeat className="mr-1 h-4 w-4" />
                  {t('streams.builder.video.loop')}
                </Button>
                <Button
                  size="sm"
                  variant={videoEditor.shuffle ? 'primary' : 'secondary'}
                  onClick={() => updateEditor('video', (prev) => ({ ...prev, shuffle: !prev.shuffle, mode: 'custom' }))}
                >
                  <Shuffle className="mr-1 h-4 w-4" />
                  {t('streams.builder.video.shuffle')}
                </Button>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {t('streams.builder.video.queueHeading')}
                    </h4>
                    {videoEditor.items.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => updateEditor('video', (prev) => ({ ...prev, items: [] }))}>
                        {t('streams.builder.video.clear')}
                      </Button>
                    )}
                  </div>
                  <div
                    className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 max-h-72 overflow-y-auto"
                    onDragOver={(event) => {
                      if (videoEditor.mode !== 'custom') return
                      event.preventDefault()
                    }}
                    onDrop={(event) => {
                      if (videoEditor.mode !== 'custom') return
                      event.preventDefault()
                      event.stopPropagation()
                      handleItemDrop('video', videoEditor.items.length, event)
                    }}
                  >
                    {videoEditor.items.length > 0 ? (
                      videoEditor.items.map((item, index) => {
                        const asset = assetMap.get(item.asset_id)
                        const draggable = videoEditor.mode === 'custom'
                        return (
                          <div
                            key={`${item.asset_id}-${index}`}
                            className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                            draggable={draggable}
                            onDragStart={(event) => handleItemDragStart('video', index, event)}
                            onDragOver={(event) => {
                              if (!draggable) return
                              event.preventDefault()
                            }}
                            onDrop={(event) => {
                              if (!draggable) return
                              event.preventDefault()
                              event.stopPropagation()
                              handleItemDrop('video', index, event)
                            }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <GripVertical className={`h-4 w-4 text-slate-400 ${!draggable ? 'opacity-40' : ''}`} />
                              <p className="truncate font-medium text-slate-900 dark:text-white">
                                {asset?.filename ?? t('streams.builder.video.unknownAsset')}
                              </p>
                            </div>
                            {draggable && (
                              <Button variant="ghost" size="icon" onClick={() => removeAssetFromEditor('video', item.asset_id)} aria-label={t('streams.liveEdit.actions.remove')}>
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <p className="text-sm text-slate-500">{t('streams.builder.video.empty')}</p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t('streams.builder.video.assetsHeading')}
                  </h4>
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 max-h-72 overflow-y-auto">
                    {isLoadingAssets ? (
                      <LoadingState text={t('loading')} />
                    ) : videoAssets.length > 0 ? (
                      videoAssets.map((asset) => {
                        const isSelected = videoEditor.items.some((entry) => entry.asset_id === asset.id)
                        return (
                          <button
                            key={`video-source-${asset.id}`}
                            type="button"
                            onClick={() => addAssetToEditor('video', asset.id)}
                            className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              isSelected
                                ? 'border-primary-400 bg-primary-50/60 dark:border-primary-500 dark:bg-primary-900/30'
                                : 'border-slate-200 hover:border-primary-300 dark:border-slate-600 dark:hover:border-primary-500'
                            }`}
                          >
                            <span className="truncate">{asset.filename}</span>
                            <Badge variant={isSelected ? 'success' : 'secondary'}>
                              {isSelected
                                ? t('channels.badge.selected')
                                : t('channels.badge.tapToSelect')}
                            </Badge>
                          </button>
                        )
                      })
                    ) : (
                      <p className="text-sm text-slate-500">{t('streams.builder.video.noAssets')}</p>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="audio" className="mt-4 space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {t('streams.builder.audio.title')}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('streams.builder.audio.subtitle')}
                  </p>
                </div>
                <Button variant={audioEnabled ? 'primary' : 'secondary'} size="sm" onClick={() => handleAudioToggle(!audioEnabled)}>
                  {audioEnabled ? t('streams.builder.audio.disable') : t('streams.builder.audio.enable')}
                </Button>
              </div>

              {!audioEnabled ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('streams.builder.audio.disabledNotice')}
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {t('streams.builder.audio.collectionLabel')}
                    </label>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center">
                      <select
                        className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                        value={isLoadingAudioCollections ? 'loading' : audioEditor.selectedCollectionId ?? 'custom'}
                        disabled={isLoadingAudioCollections}
                        onChange={(event) => handleSelectCollection('audio', event.target.value as string)}
                      >
                        <option value="custom">{t('streams.builder.audio.collectionPlaceholder')}</option>
                        {isLoadingAudioCollections ? (
                          <option value="loading" disabled>
                            {t('loading')}
                          </option>
                        ) : (
                          (audioCollections ?? []).map((collection) => (
                            <option key={collection.id} value={collection.id}>
                              {collection.name}
                            </option>
                          ))
                        )}
                      </select>
                      {audioEditor.mode === 'existing' && (
                        <Button variant="outline" size="sm" onClick={() => handleCustomizeExisting('audio')}>
                          {t('streams.builder.audio.customize')}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={audioEditor.loop ? 'primary' : 'secondary'}
                      onClick={() => updateEditor('audio', (prev) => ({ ...prev, loop: !prev.loop, mode: 'custom' }))}
                    >
                      <Repeat className="mr-1 h-4 w-4" />
                      {t('streams.builder.audio.loop')}
                    </Button>
                    <Button
                      size="sm"
                      variant={audioEditor.shuffle ? 'primary' : 'secondary'}
                      onClick={() => updateEditor('audio', (prev) => ({ ...prev, shuffle: !prev.shuffle, mode: 'custom' }))}
                    >
                      <Shuffle className="mr-1 h-4 w-4" />
                      {t('streams.builder.audio.shuffle')}
                    </Button>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {t('streams.builder.audio.queueHeading')}
                      </h4>
                      <div
                        className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 max-h-64 overflow-y-auto"
                        onDragOver={(event) => {
                          if (audioEditor.mode !== 'custom') return
                          event.preventDefault()
                        }}
                        onDrop={(event) => {
                          if (audioEditor.mode !== 'custom') return
                          event.preventDefault()
                          event.stopPropagation()
                          handleItemDrop('audio', audioEditor.items.length, event)
                        }}
                      >
                        {audioEditor.items.length > 0 ? (
                          audioEditor.items.map((item, index) => {
                            const asset = assetMap.get(item.asset_id)
                            const draggable = audioEditor.mode === 'custom'
                            return (
                              <div
                                key={`${item.asset_id}-${index}`}
                                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                                draggable={draggable}
                                onDragStart={(event) => handleItemDragStart('audio', index, event)}
                                onDragOver={(event) => {
                                  if (!draggable) return
                                  event.preventDefault()
                                }}
                                onDrop={(event) => {
                                  if (!draggable) return
                                  event.preventDefault()
                                  event.stopPropagation()
                                  handleItemDrop('audio', index, event)
                                }}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <GripVertical className={`h-4 w-4 text-slate-400 ${!draggable ? 'opacity-40' : ''}`} />
                                  <p className="truncate font-medium text-slate-900 dark:text-white">
                                    {asset?.filename ?? t('streams.builder.audio.unknownAsset')}
                                  </p>
                                </div>
                                {draggable && (
                                  <Button variant="ghost" size="icon" onClick={() => removeAssetFromEditor('audio', item.asset_id)} aria-label={t('streams.liveEdit.actions.remove')}>
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            )
                          })
                        ) : (
                          <p className="text-sm text-slate-500">{t('streams.builder.audio.empty')}</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {t('streams.builder.audio.assetsHeading')}
                      </h4>
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 max-h-64 overflow-y-auto">
                        {isLoadingAssets ? (
                          <LoadingState text={t('loading')} />
                        ) : audioAssets.length > 0 ? (
                          audioAssets.map((asset) => {
                            const isSelected = audioEditor.items.some((entry) => entry.asset_id === asset.id)
                            return (
                              <button
                                key={`audio-source-${asset.id}`}
                                type="button"
                                onClick={() => addAssetToEditor('audio', asset.id)}
                                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                                  isSelected
                                    ? 'border-primary-400 bg-primary-50/60 dark:border-primary-500 dark:bg-primary-900/30'
                                    : 'border-slate-200 hover:border-primary-300 dark:border-slate-600 dark:hover:border-primary-500'
                                }`}
                              >
                                <span className="truncate">{asset.filename}</span>
                                <Badge variant={isSelected ? 'success' : 'secondary'}>
                                  {isSelected
                                    ? t('channels.badge.selected')
                                    : t('channels.badge.tapToSelect')}
                                </Badge>
                              </button>
                            )
                          })
                        ) : (
                          <p className="text-sm text-slate-500">{t('streams.builder.audio.noAssets')}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="mt-4 space-y-4">
              <div className="space-y-1">
                {/* eslint-disable-next-line i18next/no-literal-string */}
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">Studio Timeline</h3>
                {/* eslint-disable-next-line i18next/no-literal-string */}
                <p className="text-xs text-slate-500 dark:text-slate-400">Visual overview of your stream content</p>
              </div>
              
              <TimelineEditor
                videoItems={videoEditor.items.map((item, idx) => ({
                  id: `${item.asset_id}-${idx}`,
                  asset: assetMap.get(item.asset_id)!
                })).filter(x => x.asset)}
                audioItems={audioEnabled ? audioEditor.items.map((item, idx) => ({
                  id: `${item.asset_id}-${idx}`,
                  asset: assetMap.get(item.asset_id)!
                })).filter(x => x.asset) : []}
                onReorder={reorderEditorItems}
              />
              
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 dark:border-blue-900/30 dark:bg-blue-900/10">
                {/* eslint-disable-next-line i18next/no-literal-string */}
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <Info className="inline-block w-4 h-4 mr-1.5 -mt-0.5" />
                  Drag and drop assets from the Video/Audio tabs to populate this timeline.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="destinations" className="mt-4 space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('streams.builder.destinations.title')}
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('streams.builder.destinations.subtitle')}
                </p>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {isLoadingDestinations ? (
                  <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 p-6 dark:border-slate-700">
                    <LoadingState text={t('streams.builder.destinations.loading')} />
                  </div>
                ) : destinationsList.length > 0 ? (
                  destinationsList.map((destination) => {
                    const isSelected = streamForm.destination_ids.includes(destination.id)
                    return (
                      <label
                        key={`destination-${destination.id}`}
                        htmlFor={`destination-checkbox-${destination.id}`}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg border px-3 py-3 transition-colors bg-white dark:bg-slate-900/40',
                          isSelected
                            ? 'border-success-500 bg-success-100 dark:border-success-500/80 dark:bg-success-900/30'
                            : 'border-slate-200 dark:border-slate-700 hover:border-primary-300 hover:bg-primary-50/40 dark:hover:border-primary-500 dark:hover:bg-primary-900/20',
                          destination.enabled ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            id={`destination-checkbox-${destination.id}`}
                            type="checkbox"
                            disabled={!destination.enabled}
                            checked={isSelected}
                            onChange={() => handleDestinationToggle(destination.id)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed disabled:border-slate-300"
                          />
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white">{destination.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{destination.rtmps_url}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={destination.enabled ? (isSelected ? 'success' : 'secondary') : 'warning'}>
                            {destination.enabled
                              ? isSelected
                                ? t('channels.badge.selected')
                                : t('channels.badge.tapToSelect')
                              : t('streams.builder.destinations.disabled')}
                          </Badge>
                          {destination.enabled ? (
                            <span className="text-[11px] font-medium uppercase text-slate-400 dark:text-slate-500">
                              {isSelected
                                ? t('streams.builder.destinations.selected')
                                : t('streams.builder.destinations.toggleHint')}
                            </span>
                          ) : (
                            <span className="text-[11px] font-medium uppercase text-amber-500">
                              {t('streams.builder.destinations.enableHint')}
                            </span>
                          )}
                        </div>
                      </label>
                    )
                  })
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300 space-y-3 text-center">
                    <p>{t('streams.builder.destinations.none')}</p>
                    <Button size="sm" variant="outline" onClick={onOpenChannelForm}>
                      {t('streams.builder.destinations.cta')}
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="schedule" className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('streams.form.nameLabel')}
                </label>
                <Input
                  placeholder={t('streams.form.namePlaceholder')}
                  value={streamForm.name}
                  onChange={(event) => setStreamForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('streams.builder.schedule.title')}
                </label>
                {localTimezone && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('streams.builder.schedule.timezoneHint', { timezone: localTimezone })}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={scheduleState.startMode === 'now' ? 'primary' : 'secondary'}
                    onClick={() => setScheduleState((prev) => ({ ...prev, startMode: 'now' }))}
                  >
                    {t('streams.builder.schedule.startNow')}
                  </Button>
                  <Button
                    size="sm"
                    variant={scheduleState.startMode === 'schedule' ? 'primary' : 'secondary'}
                    onClick={() => setScheduleState((prev) => ({ ...prev, startMode: 'schedule' }))}
                  >
                    {t('streams.builder.schedule.startLater')}
                  </Button>
                </div>
                {scheduleState.startMode === 'schedule' && (
                  <Input
                    type="datetime-local"
                    value={scheduleState.startAt}
                    onChange={(event) => setScheduleState((prev) => ({ ...prev, startAt: event.target.value }))}
                  />
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('streams.builder.schedule.stopLabel')}
                </label>
                <Input
                  type="datetime-local"
                  value={scheduleState.stopAt}
                  onChange={(event) => setScheduleState((prev) => ({ ...prev, stopAt: event.target.value }))}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={scheduleState.loopStream ? 'primary' : 'secondary'}
                  onClick={() => setScheduleState((prev) => ({ ...prev, loopStream: !prev.loopStream }))}
                >
                  <Repeat className="mr-1 h-4 w-4" />
                  {t('streams.builder.schedule.loop')}
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('streams.builder.schedule.videoVolume')}: {scheduleState.videoVolume}%
                  </label>
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-4 w-4 text-slate-400" />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={scheduleState.videoVolume}
                      onChange={(event) => setScheduleState((prev) => ({ ...prev, videoVolume: Number(event.target.value) }))}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {t('streams.builder.schedule.audioVolume')}: {audioEnabled ? scheduleState.audioVolume : 0}%
                  </label>
                  <div className="flex items-center gap-2">
                    <VolumeX className={`h-4 w-4 ${audioEnabled ? 'text-slate-400' : 'text-slate-300'}`} />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={audioEnabled ? scheduleState.audioVolume : 0}
                      disabled={!audioEnabled}
                      onChange={(event) => setScheduleState((prev) => ({ ...prev, audioVolume: Number(event.target.value) }))}
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('streams.builder.schedule.summaryTitle')}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                  <li>
                    {videoEditor.selectedCollectionId
                      ? t('streams.builder.schedule.summaryVideoSaved')
                      : t('streams.builder.schedule.summaryVideoCount', {
                          count: videoEditor.items.length,
                        })}
                  </li>
                  <li>
                    {audioEnabled
                      ? audioEditor.selectedCollectionId
                        ? t('streams.builder.schedule.summaryAudioSaved')
                        : t('streams.builder.schedule.summaryAudioCount', {
                            count: audioEditor.items.length,
                          })
                      : t('streams.builder.schedule.summaryAudioDisabled')}
                  </li>
                  <li>
                    {t('streams.builder.schedule.summaryDestinations', {
                      count: streamForm.destination_ids.length,
                    })}
                  </li>
                </ul>
              </div>
            </TabsContent>
          </Tabs>

          <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <Button variant="ghost" onClick={handleClose}>
                {t('streams.builder.actions.cancel')}
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setActiveBuilderTab(builderTabsList[Math.max(0, currentTabIndex - 1)])}
                  disabled={currentTabIndex === 0}
                >
                  {t('streams.builder.actions.back')}
                </Button>
                {isFinalTab ? (
                  <Button onClick={handleBuilderSubmit} isLoading={isBuilderSubmitting || createPending}>
                    {t('streams.builder.actions.create')}
                  </Button>
                ) : (
                  <Button
                    onClick={() =>
                      setActiveBuilderTab(
                        builderTabsList[Math.min(builderTabsList.length - 1, currentTabIndex + 1)],
                      )
                    }
                  >
                    {t('streams.builder.actions.next')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
