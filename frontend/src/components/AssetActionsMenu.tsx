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
          label: 'Edit',
          icon: <Pencil className="w-4 h-4" />, 
          onClick: onEdit,
        }
      : null,
    {
      label: 'Remove',
      icon: <Trash2 className="w-4 h-4" />, 
      onClick: onDelete,
      disabled: isDeleting,
      tone: 'danger',
    },
    {
      label: 'Check',
      icon: <Check className="w-4 h-4" />, 
      onClick: onCheck,
      disabled: isChecking,
    },
    onPlaylists
      ? {
          label: 'Playlists',
          icon: <List className="w-4 h-4" />, 
          onClick: onPlaylists,
        }
      : null,
    onOptimize
      ? {
          label: 'Optimization',
          icon: <Zap className="w-4 h-4" />, 
          onClick: onOptimize,
        }
      : null,
    onMove
      ? {
          label: 'Move',
          icon: <Folder className="w-4 h-4" />, 
          onClick: onMove,
        }
      : null,
    {
      label: 'Download',
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
              'fixed z-40 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900',
              menuPosition.direction === 'down' ? '' : ''
            )}
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              opacity: menuPosition.ready ? 1 : 0,
              pointerEvents: menuPosition.ready ? 'auto' : 'none',
            }}
          >
            <div className="py-1">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => handleSelect(action)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                    'hover:bg-slate-100 dark:hover:bg-slate-800',
                    action.tone === 'danger'
                      ? 'text-error-600 dark:text-error-400'
                      : 'text-slate-600 dark:text-slate-300',
                    action.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  )}
                >
                  {action.icon}
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
