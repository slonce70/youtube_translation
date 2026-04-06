'use client'
/* eslint-disable i18next/no-literal-string */

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { TranslationValues } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { LoadingState } from '@/components/LoadingState'
import type {
  Asset,
  Destination,
  MediaCollection,
  QuotaUsageResponse,
  Stream,
} from '@/lib/types'

import { useStreamBuilder } from '../hooks/useStreamBuilder'
import { formatReviewDateTime } from '../builder-helpers'
import { applyDurationPreset, DURATION_PRESETS } from '../schedule-utils'

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
  assets,
  videoCollections,
  audioCollections,
  streams,
  quota,
  t,
  streamingToasts,
  formatLimitValue,
}: StreamBuilderModalProps) {
  const actionLabels = useTranslations('common.actions')
  const locale = useLocale()
  const [sourceTab, setSourceTab] = useState<'file' | 'playlist'>('file')

  const {
    streamForm,
    setStreamForm,
    audioEnabled,
    videoEditor,
    audioEditor,
    scheduleState,
    setScheduleState,
    addAssetToEditor,
    removeAssetFromEditor,
    handleSelectCollection,
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
    concurrentStreamsLimit,
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
      setSourceTab('file')
    }
  }, [open, resetBuilderState])

  if (!open) return null

  const handleClose = () => {
    resetBuilderState()
    setSourceTab('file')
    onClose()
  }

  const destinationsList = destinationsState ?? []
  const selectedDestinations = destinationsList.filter((destination) =>
    streamForm.destination_ids.includes(destination.id),
  )
  const hasVideoSelection = Boolean(videoEditor.selectedCollectionId) || videoEditor.items.length > 0
  const startAtLabel =
    scheduleState.startMode === 'schedule' && scheduleState.startAt
      ? formatReviewDateTime(locale, scheduleState.startAt)
      : null
  const canLaunch = Boolean(selectedDestinations.length && hasVideoSelection && streamForm.name.trim())

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-[92vh] w-full max-w-7xl gap-6 overflow-hidden">
        <Card className="flex-1 overflow-y-auto">
          <CardHeader className="flex items-start justify-between space-y-0">
            <div>
              <CardTitle>📡 Нова трансляція</CardTitle>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Оберіть канал і відео — сервіс запустить трансляцію без перекодування
              </p>
            </div>
            <Button variant="ghost" onClick={handleClose} aria-label={actionLabels('close')}>
              ← Назад
            </Button>
          </CardHeader>

          <CardContent className="space-y-5">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>1 · Оберіть канал</CardTitle>
                <Button size="sm" variant="ghost" onClick={onOpenChannelForm}>
                  + Додати канал
                </Button>
              </CardHeader>
              <CardContent className="summary-list">
                {destinationsList.length > 0 ? (
                  destinationsList.map((destination) => {
                    const isSelected = streamForm.destination_ids.includes(destination.id)
                    return (
                      <button
                        key={destination.id}
                        type="button"
                        className={`channel-row${isSelected ? ' active' : ''}`}
                        onClick={() => handleDestinationToggle(destination.id)}
                      >
                        <div className="channel-logo">
                          {destination.name.toLowerCase().includes('twitch') ? '🎮' : '▶'}
                        </div>
                        <div style={{ flex: 1, textAlign: 'left' }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{destination.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
                            {destination.rtmps_url} · {destination.stream_key_masked || '••••••••'}
                          </div>
                        </div>
                        <div className={`toggle${isSelected ? ' on' : ''}`} />
                      </button>
                    )
                  })
                ) : (
                  <div className="empty-state" style={{ padding: '24px 12px' }}>
                    <div className="empty-icon">📡</div>
                    <div className="empty-title">Ще немає каналів</div>
                    <div className="empty-sub">Додайте канал перед запуском стріму.</div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2 · Джерело відео</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div style={{ display: 'flex', gap: 4, background: 'var(--bg-3)', borderRadius: 8, padding: 4 }}>
                  <button
                    type="button"
                    className={sourceTab === 'file' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                    style={{ flex: 1 }}
                    onClick={() => setSourceTab('file')}
                  >
                    📁 Файл
                  </button>
                  <button
                    type="button"
                    className={sourceTab === 'playlist' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                    style={{ flex: 1 }}
                    onClick={() => setSourceTab('playlist')}
                  >
                    📋 Плейлист
                  </button>
                </div>

                {sourceTab === 'file' ? (
                  <div className="summary-list">
                    {videoAssets.length > 0 ? (
                      videoAssets.slice(0, 12).map((asset) => {
                        const isSelected = videoEditor.items.some((item) => item.asset_id === asset.id)
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            className={`asset-row${isSelected ? ' active' : ''}`}
                            onClick={() =>
                              isSelected ? removeAssetFromEditor('video', asset.id) : addAssetToEditor('video', asset.id)
                            }
                          >
                            <div className="asset-thumb">🎬</div>
                            <div style={{ flex: 1, textAlign: 'left' }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{asset.filename}</div>
                              <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                                {asset.size_bytes ? `${Math.round(asset.size_bytes / 1024 / 1024)} MB` : '—'} ·{' '}
                                {asset.duration_seconds
                                  ? `${Math.floor(asset.duration_seconds / 60)}:${String(Math.floor(asset.duration_seconds % 60)).padStart(2, '0')}`
                                  : '—'}{' '}
                                · Готово до трансляції
                              </div>
                            </div>
                            {isSelected ? <Badge variant="indigo">✓</Badge> : null}
                          </button>
                        )
                      })
                    ) : (
                      <div className="empty-state" style={{ padding: '24px 12px' }}>
                        <div className="empty-icon">🎬</div>
                        <div className="empty-title">Немає доступних відео</div>
                        <div className="empty-sub">Завантажте файли у бібліотеку.</div>
                      </div>
                    )}
                    <button
                      type="button"
                      className="drop-overlay"
                      style={{ position: 'relative', inset: 'auto', pointerEvents: 'auto', minHeight: 64, margin: 0 }}
                      onClick={() => window.location.assign('/dashboard/library?tab=assets')}
                    >
                      <div className="empty-sub">+ Завантажити новий файл у бібліотеку</div>
                    </button>
                  </div>
                ) : (
                  <div className="summary-list">
                    {videoCollections && videoCollections.length > 0 ? (
                      videoCollections.map((collection) => {
                        const isSelected = videoEditor.selectedCollectionId === collection.id && videoEditor.mode === 'existing'
                        return (
                          <button
                            key={collection.id}
                            type="button"
                            className={`playlist-row${isSelected ? ' active' : ''}`}
                            onClick={() => handleSelectCollection('video', collection.id)}
                          >
                            <div className="asset-thumb">📋</div>
                            <div style={{ flex: 1, textAlign: 'left' }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{collection.name}</div>
                              <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{collection.items.length} елементів</div>
                            </div>
                            {isSelected ? <Badge variant="indigo">Обрано</Badge> : null}
                          </button>
                        )
                      })
                    ) : (
                      <div className="empty-state" style={{ padding: '24px 12px' }}>
                        <div className="empty-icon">📋</div>
                        <div className="empty-title">Плейлистів ще немає</div>
                        <div className="empty-sub">Створіть плейлист у розділі Файли для безперервного ефіру.</div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>3 · Налаштування</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="page-sub" style={{ display: 'block', marginBottom: 6 }}>Назва трансляції *</label>
                  <Input
                    value={streamForm.name}
                    onChange={(event) => setStreamForm((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder={t('streams.form.namePlaceholder')}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Час початку</div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                    <button
                      type="button"
                      className={scheduleState.startMode === 'now' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                      onClick={() => setScheduleState((prev) => ({ ...prev, startMode: 'now' }))}
                    >
                      ▶ Зараз
                    </button>
                    <button
                      type="button"
                      className={scheduleState.startMode === 'schedule' ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                      onClick={() => setScheduleState((prev) => ({ ...prev, startMode: 'schedule' }))}
                    >
                      🗓️ Запланувати
                    </button>
                  </div>
                  {scheduleState.startMode === 'schedule' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Input
                        type="datetime-local"
                        value={scheduleState.startAt}
                        onChange={(event) => setScheduleState((prev) => ({ ...prev, startAt: event.target.value }))}
                      />
                      <Input
                        type="datetime-local"
                        value={scheduleState.stopAt}
                        onChange={(event) => setScheduleState((prev) => ({ ...prev, stopAt: event.target.value }))}
                      />
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    {DURATION_PRESETS.map((hours) => (
                      <Button
                        key={hours}
                        size="sm"
                        variant="outline"
                        onClick={() => setScheduleState((prev) => ({ ...prev, ...applyDurationPreset(prev, hours) }))}
                      >
                        {hours} год
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="summary-list">
                  <button
                    type="button"
                    className={scheduleState.loopStream ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                    onClick={() => setScheduleState((prev) => ({ ...prev, loopStream: !prev.loopStream }))}
                  >
                    🔄 Повторювати файл у циклі
                  </button>
                  <button
                    type="button"
                    className={audioEnabled ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                    onClick={() => handleAudioToggle(!audioEnabled)}
                  >
                    {audioEnabled ? '🎵 Аудіо увімкнено' : '🎵 Додати аудіо'}
                  </button>
                </div>

                {audioEnabled ? (
                  <div className="summary-list">
                    {audioAssets.slice(0, 6).map((asset) => {
                      const isSelected = audioEditor.items.some((item) => item.asset_id === asset.id)
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          className={`asset-row${isSelected ? ' active' : ''}`}
                          onClick={() =>
                            isSelected ? removeAssetFromEditor('audio', asset.id) : addAssetToEditor('audio', asset.id)
                          }
                        >
                          <div className="asset-thumb">🎵</div>
                          <div style={{ flex: 1, textAlign: 'left' }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{asset.filename}</div>
                            <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                              {asset.duration_seconds
                                ? `${Math.floor(asset.duration_seconds / 60)}:${String(Math.floor(asset.duration_seconds % 60)).padStart(2, '0')}`
                                : '—'}
                            </div>
                          </div>
                          {isSelected ? <Badge variant="indigo">✓</Badge> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        <div className="sticky-summary" style={{ width: 340 }}>
          <Card className="summary-card" style={{ borderColor: 'rgba(99,102,241,.3)' }}>
            <CardHeader><CardTitle>📋 Підсумок трансляції</CardTitle></CardHeader>
            <CardContent className="summary-list" style={{ fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 80, color: 'var(--txt-3)' }}>Канал</span><span>{selectedDestinations[0]?.name ?? '— не обрано'}</span></div>
              <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 80, color: 'var(--txt-3)' }}>Файл</span><span>{videoEditor.items[0] ? (assetMap.get(videoEditor.items[0].asset_id)?.filename ?? '—') : '— не обрано'}</span></div>
              <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 80, color: 'var(--txt-3)' }}>Тривалість</span><span>{videoEditor.items[0] ? 'Залежить від джерела' : '—'}</span></div>
              <div style={{ display: 'flex', gap: 8 }}><span style={{ width: 80, color: 'var(--txt-3)' }}>Старт</span><span>{scheduleState.startMode === 'now' ? 'Одразу після запуску' : (startAtLabel ?? 'Заплановано')}</span></div>
            </CardContent>
          </Card>

          <Card className="card-sm">
            <CardTitle>✅ Готовність</CardTitle>
            <CardContent className="summary-list" style={{ marginTop: 10 }}>
              <div style={{ color: selectedDestinations.length ? 'var(--green)' : 'var(--red)' }}>{selectedDestinations.length ? '✓' : '✗'} Оберіть канал</div>
              <div style={{ color: hasVideoSelection ? 'var(--green)' : 'var(--red)' }}>{hasVideoSelection ? '✓' : '✗'} Файл обрано</div>
              <div style={{ color: streamForm.name.trim() ? 'var(--green)' : 'var(--red)' }}>{streamForm.name.trim() ? '✓' : '✗'} Введіть назву</div>
              <div style={{ color: 'var(--green)' }}>✓ Ліміт: {runningStreams.length}/{formatLimitValue(concurrentStreamsLimit)} паралельних ефірів</div>
            </CardContent>
          </Card>

          <div className="info-box" style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', padding: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--indigo-lt)', fontWeight: 600, marginBottom: 6 }}>ℹ️ Як це працює</div>
            <div style={{ fontSize: 12, color: 'var(--txt-2)', lineHeight: 1.6 }}>
              Сервіс зчитає ваш файл і надішле потік напряму на YouTube/Twitch через RTMPS — без перекодування. Навантаження на ваш ПК: нуль.
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
            📡 Запустити ефір
          </Button>
        </div>
      </div>
    </div>
  )
}
