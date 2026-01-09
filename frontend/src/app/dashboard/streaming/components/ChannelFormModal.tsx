import type { FormEvent } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

import type { DestinationFormState, TranslationFn } from '../types'

type Props = {
  open: boolean
  editingChannelId: string | null
  channelForm: DestinationFormState
  onChange: (next: DestinationFormState) => void
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
  isSaving: boolean
  t: TranslationFn
}

export function ChannelFormModal({
  open,
  editingChannelId,
  channelForm,
  onChange,
  onSubmit,
  onCancel,
  isSaving,
  t,
}: Props) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
      <Card className="w-full max-w-lg animate-scale-in">
        <CardHeader>
          <CardTitle>
            {editingChannelId ? t('channels.form.editTitle') : t('channels.form.newTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                {t('channels.form.nameLabel')}
              </label>
              <Input
                type="text"
                required
                value={channelForm.name}
                onChange={(event) => onChange({ ...channelForm, name: event.target.value })}
                placeholder={t('channels.form.namePlaceholder')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                {t('channels.form.urlLabel')}
              </label>
              <Input
                type="text"
                required
                value={channelForm.rtmps_url}
                onChange={(event) => onChange({ ...channelForm, rtmps_url: event.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                {t('channels.form.keyLabel')}{' '}
                {editingChannelId ? t('channels.form.keepExisting') : ''}
              </label>
              <Input
                type="password"
                required={!editingChannelId}
                value={channelForm.stream_key}
                onChange={(event) => onChange({ ...channelForm, stream_key: event.target.value })}
                placeholder="xxxx-xxxx-xxxx-xxxx"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('channels.form.keyHint')}
              </p>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={channelForm.enabled}
                onChange={(event) => onChange({ ...channelForm, enabled: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
              />
              <label className="ml-2 block text-sm text-slate-700 dark:text-slate-300">
                {t('channels.form.enabled')}
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" onClick={onCancel} variant="secondary">
                {t('channels.form.cancel')}
              </Button>
              <Button type="submit" isLoading={isSaving}>
                {editingChannelId ? t('channels.form.update') : t('channels.form.create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
