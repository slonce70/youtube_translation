'use client'

import { X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import type { Asset } from '@/lib/types'

type RenameAssetModalProps = {
  asset: Asset | null
  cancelLabel: string
  closeLabel: string
  description: string
  inputLabel: string
  isLoading: boolean
  onClose: () => void
  onRenameValueChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  renameValue: string
  saveLabel: string
  title: string
}

export function RenameAssetModal({
  asset,
  cancelLabel,
  closeLabel,
  description,
  inputLabel,
  isLoading,
  onClose,
  onRenameValueChange,
  onSubmit,
  renameValue,
  saveLabel,
  title,
}: RenameAssetModalProps) {
  if (!asset) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {description}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
              <span className="sr-only">{closeLabel}</span>
            </Button>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {inputLabel}
              </label>
              <Input
                value={renameValue}
                onChange={(event) => onRenameValueChange(event.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                {cancelLabel}
              </Button>
              <Button type="submit" isLoading={isLoading} className="gap-2">
                {saveLabel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
