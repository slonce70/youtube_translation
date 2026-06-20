'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DropdownMenuProps {
  children: ReactNode
  disabled?: boolean
  label?: string
}

export function DropdownMenu({ children, disabled, label }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label={label ?? 'More actions'}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-[160px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div onClick={() => setOpen(false)}>
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

interface DropdownItemProps {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
}

export function DropdownItem({ children, onClick, variant = 'default', disabled }: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
        variant === 'danger'
          ? 'text-error-600 hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-900/20'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      {children}
    </button>
  )
}
