'use client'
/* eslint-disable i18next/no-literal-string */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from './Modal'

type CommandItem = {
  id: string
  icon: string
  label: string
  sub: string
  href?: string
  action?: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  items: CommandItem[]
}

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) =>
      `${item.label} ${item.sub}`.toLowerCase().includes(q)
    )
  }, [items, query])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  const runItem = (item: CommandItem) => {
    onClose()
    if (item.action) {
      item.action()
      return
    }
    if (item.href) router.push(item.href)
  }

  return (
    <Modal open={open} onClose={onClose} className="cmd-palette-modal">
      <div className="cmd-palette-head">
        <span className="cmd-palette-icon">🔍</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && filtered[0]) {
              runItem(filtered[0])
            }
          }}
          placeholder="Перейдіть до… наприклад «Файли» або «Трансляції»"
          className="cmd-palette-input"
        />
        <kbd className="search-kbd">Esc</kbd>
      </div>
      <div className="cmd-palette-list">
        {filtered.map((item) => (
          <button key={item.id} type="button" className="cmd-item" onClick={() => runItem(item)}>
            <span className="cmd-item-icon">{item.icon}</span>
            <span>
              <span className="cmd-item-label">{item.label}</span>
              <span className="cmd-item-sub">{item.sub}</span>
            </span>
          </button>
        ))}
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <div className="empty-icon">🔎</div>
            <div className="empty-title">Нічого не знайдено</div>
            <div className="empty-sub">Спробуйте інший запит.</div>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
