'use client'

import { X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import type { MediaFolder } from '@/lib/types'

type FolderModalState =
  | { mode: 'create' | 'rename' | 'delete'; folder: MediaFolder | null }
  | null

type FolderModalProps = {
  closeLabel: string
  deleteLabel: string
  deleteMessage: string
  folderNameInput: string
  isLoading: boolean
  modeState: FolderModalState
  nameLabel: string
  onClose: () => void
  onDelete: () => void
  onNameChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  saveLabel: string
  selectedFolderName: string
  titleCreate: string
  titleDelete: string
  titleRename: string
}

export function FolderModal({
  closeLabel,
  deleteLabel,
  deleteMessage,
  folderNameInput,
  isLoading,
  modeState,
  nameLabel,
  onClose,
  onDelete,
  onNameChange,
  onSubmit,
  saveLabel,
  selectedFolderName,
  titleCreate,
  titleDelete,
  titleRename,
}: FolderModalProps) {
  if (!modeState) {
    return null
  }

  const isDelete = modeState.mode === 'delete'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                {isDelete
                  ? titleDelete
                  : modeState.mode === 'create'
                    ? titleCreate
                    : titleRename}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {isDelete ? deleteMessage : selectedFolderName}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
              <span className="sr-only">{closeLabel}</span>
            </Button>
          </div>

          {isDelete ? (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                {closeLabel}
              </Button>
              <Button variant="danger" onClick={onDelete} isLoading={isLoading}>
                {deleteLabel}
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {nameLabel}
                </label>
                <Input
                  value={folderNameInput}
                  onChange={(event) => onNameChange(event.target.value)}
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  {closeLabel}
                </Button>
                <Button type="submit" isLoading={isLoading}>
                  {saveLabel}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
