'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  MoreVertical,
  Pencil,
  Trash2,
  Check,
  List,
  Zap,
  Folder,
  Download,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

interface AssetActionsMenuProps {
  onEdit?: () => void
  onDelete: () => void
  onCheck: () => void
  onPlaylists?: () => void
  onOptimize?: () => void
  onMove?: () => void
  onDownload: () => void
  isDeleting?: boolean
  isChecking?: boolean
  isGeneratingDownload?: boolean
}

type MenuAction = {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'danger'
}

export function AssetActionsMenu({
  onEdit,
  onDelete,
  onCheck,
  onPlaylists,
  onOptimize,
  onMove,
  onDownload,
  isDeleting,
  isChecking,
  isGeneratingDownload,
}: AssetActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<
    { top: number; left: number; direction: 'down' | 'up'; ready: boolean } | null
  >(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const tLibraryMenu = useTranslations('library.page.assets.menu')

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const updatePosition = useCallback(() => {
    if (!buttonRef.current || !panelRef.current) {
      return
    }

    const buttonRect = buttonRef.current.getBoundingClientRect()
    const panelHeight = panelRef.current.offsetHeight
    const panelWidth = panelRef.current.offsetWidth

    const spaceBelow = window.innerHeight - buttonRect.bottom
    const spaceAbove = buttonRect.top
    const preferDown = spaceBelow >= panelHeight || spaceBelow >= spaceAbove
    const direction: 'down' | 'up' = preferDown ? 'down' : 'up'

    const top = direction === 'down'
      ? Math.min(window.innerHeight - panelHeight - 8, buttonRect.bottom + 8)
      : Math.max(8, buttonRect.top - panelHeight - 8)
    const left = Math.min(
      window.innerWidth - panelWidth - 8,
      Math.max(8, buttonRect.right - panelWidth)
    )

    setMenuPosition({ top, left, direction, ready: true })
  }, [])

  useEffect(() => {
    setMenuPosition((prev) => {
      if (!open) {
        return null
      }

      if (prev && !prev.ready) {
        return prev
      }

      return {
        top: prev?.top ?? 0,
        left: prev?.left ?? 0,
        direction: prev?.direction ?? 'down',
        ready: false,
      }
    })
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      return
    }

    if (!menuPosition || menuPosition.ready === true) {
      return
    }

    if (!buttonRef.current || !panelRef.current) {
      return
    }

    updatePosition()
  }, [open, menuPosition, updatePosition])

  useEffect(() => {
    if (!open) {
      return
    }

    const frame = requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  const actions: MenuAction[] = [
    onEdit
      ? {
          label: tLibraryMenu('items.edit'),
          icon: <Pencil className="w-4 h-4" />, 
          onClick: onEdit,
        }
      : null,
    {
      label: tLibraryMenu('items.remove'),
      icon: <Trash2 className="w-4 h-4" />, 
      onClick: onDelete,
      disabled: isDeleting,
      tone: 'danger',
    },
    {
      label: tLibraryMenu('items.check'),
      icon: <Check className="w-4 h-4" />, 
      onClick: onCheck,
      disabled: isChecking,
    },
    onPlaylists
      ? {
          label: tLibraryMenu('items.playlists'),
          icon: <List className="w-4 h-4" />, 
          onClick: onPlaylists,
        }
      : null,
    onOptimize
      ? {
          label: tLibraryMenu('items.optimize'),
          icon: <Zap className="w-4 h-4" />, 
          onClick: onOptimize,
        }
      : null,
    onMove
      ? {
          label: tLibraryMenu('items.move'),
          icon: <Folder className="w-4 h-4" />, 
          onClick: onMove,
        }
      : null,
    {
      label: tLibraryMenu('items.download'),
      icon: <Download className="w-4 h-4" />, 
      onClick: onDownload,
      disabled: isGeneratingDownload,
    },
  ].filter(Boolean) as MenuAction[]

  const handleSelect = (action: MenuAction) => {
    setOpen(false)
    action.onClick()
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-100"
        onClick={() => setOpen((prev) => !prev)}
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="w-4 h-4" />
        <span className="sr-only">{tLibraryMenu('srLabel')}</span>
      </Button>

      {open && menuPosition &&
        createPortal(
          <div
            role="menu"
            ref={panelRef}
            className={cn(
              'asset-actions-menu fixed z-40 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950',
              menuPosition.direction === 'down' ? '' : ''
            )}
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              opacity: menuPosition.ready ? 1 : 0,
              pointerEvents: menuPosition.ready ? 'auto' : 'none',
            }}
          >
            <div className="asset-actions-head">
              <span>{tLibraryMenu('srLabel')}</span>
              <small>{actions.length}</small>
            </div>
            <div className="asset-actions-list">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => handleSelect(action)}
                  className={cn(
                    'asset-actions-item flex w-full items-center gap-3 text-sm text-left transition-colors',
                    action.tone === 'danger'
                      ? 'asset-actions-item-danger text-error-600 dark:text-error-400'
                      : 'text-slate-600 dark:text-slate-300',
                    action.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  )}
                >
                  <span className="asset-actions-icon" aria-hidden="true">{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
