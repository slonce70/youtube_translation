'use client'
/* eslint-disable i18next/no-literal-string */

import type { FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import type { DestinationFormState, TranslationFn } from '@/app/dashboard/streaming/types'
import type { YoutubeConnection } from '@/lib/types'

interface AddChannelModalProps {
  open: boolean
  editingChannelId: string | null
  channelForm: DestinationFormState
  youtubeConnections?: YoutubeConnection[]
  onChange: (next: DestinationFormState) => void
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
  onStartYouTubeConnect: () => void
  isSaving: boolean
  t: TranslationFn
}

export function AddChannelModal({
  open,
  editingChannelId,
  channelForm,
  youtubeConnections,
  onChange,
  onSubmit,
  onCancel,
  onStartYouTubeConnect,
  isSaving,
  t,
}: AddChannelModalProps) {
  return (
    <Modal open={open} onClose={onCancel} className="w-full max-w-[520px]">
      <div style={{ fontSize: 32, marginBottom: 12 }}>📡</div>
      <div className="card-title" style={{ fontSize: 17, marginBottom: 8 }}>
        {editingChannelId ? t('channels.form.editTitle') : t('channels.add')}
      </div>
      <div className="card-description" style={{ marginBottom: 16 }}>
        {t('provider.modalDescription')}
      </div>

      <form onSubmit={onSubmit} className="summary-list">
        <div>
          <label className="page-sub" style={{ display: 'block', marginBottom: 6 }}>{t('channels.form.nameLabel')}</label>
          <Input
            required
            value={channelForm.name}
            onChange={(event) => onChange({ ...channelForm, name: event.target.value })}
            placeholder={t('channels.form.namePlaceholder')}
          />
        </div>

        <div>
          <label className="page-sub" style={{ display: 'block', marginBottom: 6 }}>{t('channels.form.urlLabel')}</label>
          <Input
            required
            value={channelForm.rtmps_url}
            onChange={(event) => onChange({ ...channelForm, rtmps_url: event.target.value })}
            placeholder="rtmps://a.rtmps.youtube.com/live2"
          />
        </div>

        <div>
          <label className="page-sub" style={{ display: 'block', marginBottom: 6 }}>{t('provider.linkLabel')}</label>
          <select
            className="input"
            value={channelForm.provider_connection_id ?? ''}
            onChange={(event) =>
              onChange({
                ...channelForm,
                provider_connection_id: event.target.value || null,
              })
            }
          >
            <option value="">{t('provider.linkNone')}</option>
            {(youtubeConnections ?? []).map((connection) => (
              <option key={connection.id} value={connection.id}>
                {(connection.youtube_channel_title || connection.youtube_channel_id)}
              </option>
            ))}
          </select>
          <div className="page-sub" style={{ marginTop: 6 }}>
            {t('provider.linkHint')}
          </div>
        </div>

        <div>
          <label className="page-sub" style={{ display: 'block', marginBottom: 6 }}>
            Stream Key {editingChannelId ? t('channels.form.keepExisting') : ''}
          </label>
          <Input
            type="password"
            required={!editingChannelId}
            value={channelForm.stream_key}
            onChange={(event) => onChange({ ...channelForm, stream_key: event.target.value })}
            placeholder="Вставте ключ з YouTube Studio"
          />
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <a
              href="https://studio.youtube.com/"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--indigo-lt)' }}
            >
              Де знайти stream key у YouTube Studio? →
            </a>
          </div>
        </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-3)', marginBottom: 8 }}>
            {t('provider.oauthTitle')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 min-w-[180px] justify-between"
              onClick={onStartYouTubeConnect}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#ff0000' }}>▶</span>
                <span>{t('provider.youtubeCta')}</span>
              </span>
              <Badge variant="live" style={{ fontSize: 10, padding: '2px 6px' }}>{t('provider.youtubeBadge')}</Badge>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 min-w-[180px] justify-between"
              disabled
              title="Поза scope цього релізу"
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#9146ff' }}>🎮</span>
                <span>{t('provider.twitchCta')}</span>
              </span>
              <Badge variant="warn" style={{ fontSize: 10, padding: '2px 6px' }}>{t('provider.twitchBadge')}</Badge>
            </Button>
          </div>
          <div style={{ color: 'var(--txt-3)', fontSize: 12, marginTop: 8 }}>
            {t('provider.scopeHint')}
          </div>
        </div>

        <label className="toggle-wrap">
          <input
            type="checkbox"
            checked={channelForm.enabled}
            onChange={(event) => onChange({ ...channelForm, enabled: event.target.checked })}
          />
          <span className="toggle-label">{t('channels.form.enabled')}</span>
        </label>

        <div className="page-actions" style={{ marginTop: 8 }}>
          <Button type="button" variant="ghost" onClick={onCancel}>{t('channels.form.cancel')}</Button>
          <Button type="submit" isLoading={isSaving}>{editingChannelId ? t('channels.form.update') : t('channels.add')}</Button>
        </div>
      </form>
    </Modal>
  )
}
