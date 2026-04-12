'use client'

import { CheckCircle } from 'lucide-react'

import type { MediaFolder } from '@/lib/types'

type FolderSelectionTreeProps = {
  folderChildren: Map<string | null, MediaFolder[]>
  onSelect: (folderId: string) => void
  rootFolderId: string | null
  rootOptionLabel: string
  selectedFolderId: string
}

function FolderSelectionBranch({
  depth = 0,
  folderChildren,
  onSelect,
  parentId,
  selectedFolderId,
}: {
  depth?: number
  folderChildren: Map<string | null, MediaFolder[]>
  onSelect: (folderId: string) => void
  parentId: string | null
  selectedFolderId: string
}) {
  const children = folderChildren.get(parentId) ?? []

  return (
    <>
      {children.map((folder) => (
        <div key={`move-${folder.id}`}>
          <button
            type="button"
            onClick={() => onSelect(folder.id)}
            className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
              selectedFolderId === folder.id
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-100'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
            style={{ paddingLeft: depth ? depth * 12 : 0 }}
          >
            <span className="truncate">{folder.name}</span>
            {selectedFolderId === folder.id && <CheckCircle className="h-4 w-4" />}
          </button>
          <FolderSelectionBranch
            depth={depth + 1}
            folderChildren={folderChildren}
            onSelect={onSelect}
            parentId={folder.id}
            selectedFolderId={selectedFolderId}
          />
        </div>
      ))}
    </>
  )
}

export function FolderSelectionTree({
  folderChildren,
  onSelect,
  rootFolderId,
  rootOptionLabel,
  selectedFolderId,
}: FolderSelectionTreeProps) {
  return (
    <>
      {rootFolderId && (
        <button
          type="button"
          onClick={() => onSelect(rootFolderId)}
          className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
            selectedFolderId === rootFolderId
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-100'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          <span className="truncate">{rootOptionLabel}</span>
          {selectedFolderId === rootFolderId && <CheckCircle className="h-4 w-4" />}
        </button>
      )}
      <FolderSelectionBranch
        folderChildren={folderChildren}
        onSelect={onSelect}
        parentId={rootFolderId ?? null}
        selectedFolderId={selectedFolderId}
      />
    </>
  )
}
