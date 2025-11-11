'use client'

import { Edit, Folder, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import type { MediaFolder } from '@/lib/types'

interface FolderCardProps {
  folder: MediaFolder
  itemCount?: number
  onOpen: (folderId: string) => void
  onRename?: (folder: MediaFolder) => void
  onDelete?: (folder: MediaFolder) => void
  onDragOver?: (event: React.DragEvent) => void
  onDragLeave?: () => void
  onDrop?: (event: React.DragEvent) => void
  isDragOver?: boolean
}

export function FolderCard({
  folder,
  itemCount = 0,
  onOpen,
  onRename,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragOver = false,
}: FolderCardProps) {
  const t = useTranslations('library.page.folderDisplay')
  const tFolders = useTranslations('library.folders')

  const handleDoubleClick = () => {
    onOpen(folder.id)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(folder.id)
    }
  }

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md hover:border-primary-200 dark:hover:border-primary-800 ${
        isDragOver ? 'ring-2 ring-primary-300 dark:ring-primary-600 bg-primary-50 dark:bg-primary-900/20' : ''
      }`}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      tabIndex={0}
      role="button"
      aria-label={`${t('openFolder')}: ${folder.name}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                <Folder className="h-6 w-6" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-slate-900 dark:text-white truncate mb-1">
                {folder.name}
              </h3>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {t('itemCount', { count: itemCount })}
                </Badge>
                {folder.is_root && (
                  <Badge variant="info" className="text-xs">
                    {tFolders('root')}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {!folder.is_root && (onRename || onDelete) && (
            <div className="flex items-center gap-1">
              {onRename && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRename(folder)
                  }}
                  className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  aria-label={`${tFolders('rename')}: ${folder.name}`}
                >
                  <Edit className="h-4 w-4" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(folder)
                  }}
                  className="rounded p-1.5 text-slate-400 transition-colors hover:bg-error-100 hover:text-error-600 dark:hover:bg-error-900/30 dark:hover:text-error-400"
                  aria-label={`${tFolders('delete')}: ${folder.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
