'use client'

import { ChevronRight, Home } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { MediaFolder } from '@/lib/types'

interface BreadcrumbsProps {
  currentFolderId: string | 'all'
  folders?: MediaFolder[]
  onNavigate: (folderId: string | 'all') => void
  onDrop?: (folderId: string | 'all') => void
}

export function Breadcrumbs({ currentFolderId, folders, onNavigate, onDrop }: BreadcrumbsProps) {
  const t = useTranslations('library.page.breadcrumbs')

  // Build breadcrumb path from current folder to root
  const buildPath = (): Array<{ id: string | 'all'; name: string; is_root?: boolean }> => {
    if (!folders || folders.length === 0) {
      return [{ id: 'all', name: t('allFiles') }]
    }

    if (currentFolderId === 'all') {
      return [{ id: 'all', name: t('allFiles') }]
    }

    const path: Array<{ id: string; name: string; is_root?: boolean }> = []
    let currentId: string | null = currentFolderId

    // Traverse from current folder up to root
    while (currentId) {
      const folder = folders.find((f) => f.id === currentId)
      if (!folder) break

      path.unshift({
        id: folder.id,
        name: folder.name,
        is_root: folder.is_root,
      })

      currentId = folder.parent_id ?? null
    }

    // Add "All Files" at the beginning if not starting from root
    if (path.length === 0 || !path[0].is_root) {
      path.unshift({ id: 'all', name: t('allFiles') })
    }

    return path
  }

  const breadcrumbPath = buildPath()

  const handleDragOver = (event: React.DragEvent, folderId: string | 'all') => {
    if (onDrop) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
  }

  const handleDrop = (event: React.DragEvent, folderId: string | 'all') => {
    if (onDrop) {
      event.preventDefault()
      onDrop(folderId)
    }
  }

  return (
    <nav className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
      <button
        type="button"
        onClick={() => onNavigate('all')}
        onDragOver={(e) => handleDragOver(e, 'all')}
        onDrop={(e) => handleDrop(e, 'all')}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
        aria-label={t('home')}
      >
        <Home className="h-4 w-4" />
        <span className="sr-only">{t('home')}</span>
      </button>

      {breadcrumbPath.map((item, index) => {
        const isLast = index === breadcrumbPath.length - 1

        return (
          <div key={item.id} className="flex items-center space-x-2">
            <ChevronRight className="h-4 w-4 text-slate-400" />
            <button
              type="button"
              onClick={() => !isLast && onNavigate(item.id)}
              onDragOver={(e) => handleDragOver(e, item.id)}
              onDrop={(e) => handleDrop(e, item.id)}
              disabled={isLast}
              className={`rounded-md px-2 py-1 transition-colors ${
                isLast
                  ? 'font-semibold text-slate-900 dark:text-white cursor-default'
                  : 'hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer'
              }`}
              aria-current={isLast ? 'page' : undefined}
            >
              {item.name}
            </button>
          </div>
        )
      })}
    </nav>
  )
}
