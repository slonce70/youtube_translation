'use client'

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  ariaLabel?: string
  ariaLabelledBy?: string
  className?: string
  children: ReactNode
}

export function Modal({ open, onClose, ariaLabel, ariaLabelledBy, className, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  useEffect(() => {
    if (!open) return undefined
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const requestFrame = window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 0))
    const cancelFrame = window.cancelAnimationFrame ?? window.clearTimeout
    const frame = requestFrame(() => {
      if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) {
        dialogRef.current.focus({ preventScroll: true })
      }
    })
    return () => {
      cancelFrame(frame)
      previousFocusRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <div
      className={cn('modal-overlay', open && 'open')}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={cn('modal', className)}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}
