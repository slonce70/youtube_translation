'use client'
/* eslint-disable i18next/no-literal-string */

import type { FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { CopyField } from '@/components/ui/CopyField'
import type { DestinationFormState, TranslationFn } from '@/app/dashboard/streaming/types'

interface AddChannelModalProps {
  open: boolean
  editingChannelId: string | null
  channelForm: DestinationFormState
  onChange: (next: DestinationFormState) => void
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
  isSaving: boolean
  t: TranslationFn
}

export function AddChannelModal({
  open,
  editingChannelId,
  channelForm,
  onChange,
  onSubmit,
  onCancel,
  isSaving,
  t,
}: AddChannelModalProps) {
  return (
    <Modal open={open} onClose={onCancel} className="w-full max-w-[520px]">
      <div style={{ fontSize: 32, marginBottom: 12 }}>📡</div>
      <div className="card-title" style={{ fontSize: 17, marginBottom: 8 }}>
        {editingChannelId ? t('channels.form.editTitle') : 'Додати канал'}
      </div>
      <div className="card-description" style={{ marginBottom: 16 }}>
        Вставте RTMPS URL і stream key з вашого YouTube Studio / Twitch / будь-якої платформи.
      </div>

      <form onSubmit={onSubmit} className="summary-list">
        <div>
          <label className="page-sub" style={{ display: 'block', marginBottom: 6 }}>Назва каналу</label>
          <Input
            required
            value={channelForm.name}
            onChange={(event) => onChange({ ...channelForm, name: event.target.value })}
            placeholder={t('channels.form.namePlaceholder')}
          />
        </div>

        <div>
          <label className="page-sub" style={{ display: 'block', marginBottom: 6 }}>RTMPS URL</label>
          <Input
            required
            value={channelForm.rtmps_url}
            onChange={(event) => onChange({ ...channelForm, rtmps_url: event.target.value })}
            placeholder="rtmps://a.rtmps.youtube.com/live2"
          />
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

        {editingChannelId ? (
          <CopyField value={channelForm.rtmps_url} copyLabel="Копіювати URL" copiedMessage="RTMPS URL скопійовано" />
        ) : null}

        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-3)', marginBottom: 8 }}>
            АБО — швидке підключення через OAuth
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type="button" variant="outline" size="sm" className="flex-1 min-w-[180px]">
              <span style={{ color: '#ff0000' }}>▶</span> YouTube OAuth
            </Button>
            <Button type="button" variant="outline" size="sm" className="flex-1 min-w-[180px]">
              <span style={{ color: '#9146ff' }}>🎮</span> Twitch OAuth
            </Button>
          </div>
          <div style={{ color: 'var(--txt-3)', fontSize: 12, marginTop: 8 }}>
            OAuth заповнить URL і ключ автоматично — рекомендовано для початківців.
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
          <Button type="button" variant="ghost" onClick={onCancel}>Скасувати</Button>
          <Button type="submit" isLoading={isSaving}>{editingChannelId ? t('channels.form.update') : 'Зберегти канал'}</Button>
        </div>
      </form>
    </Modal>
  )
}
