'use client'

import { X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import type { Asset, MediaFolder } from '@/lib/types'

import { FolderSelectionTree } from './FolderSelectionTree'

type MoveAssetsModalProps = {
  assets: Asset[]
  closeLabel: string
  isLoading: boolean
  isOpen: boolean
  moveConfirmLabel: string
  onClose: () => void
  onConfirm: () => void
  onSelectFolder: (folderId: string) => void
  rootFolderId: string | null
  rootOptionLabel: string
  selectedFolderId: string
  selectionCountLabel: string
  targetLabel: string
  title: string
  unknownValueLabel: string
  description: string
  folderChildren: Map<string | null, MediaFolder[]>
}

export function MoveAssetsModal({
  assets,
  closeLabel,
  description,
  folderChildren,
  isLoading,
  isOpen,
  moveConfirmLabel,
  onClose,
  onConfirm,
  onSelectFolder,
  rootFolderId,
  rootOptionLabel,
  selectedFolderId,
  selectionCountLabel,
  targetLabel,
  title,
  unknownValueLabel,
}: MoveAssetsModalProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 py-6">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              {title}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {description}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {targetLabel}
            </p>
            <div className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 px-2 py-2 dark:border-slate-700">
              <FolderSelectionTree
                folderChildren={folderChildren}
                onSelect={onSelectFolder}
                rootFolderId={rootFolderId}
                rootOptionLabel={rootOptionLabel}
                selectedFolderId={selectedFolderId}
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {selectionCountLabel}
            </p>
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
              {assets.length > 0 ? (
                <ul className="space-y-1">
                  {assets.map((asset) => (
                    <li key={`moving-${asset.id}`} className="truncate">
                      {asset.filename}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500 dark:text-slate-400">
                  {unknownValueLabel}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            {closeLabel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!selectedFolderId}
            isLoading={isLoading}
          >
            {moveConfirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
