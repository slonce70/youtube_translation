'use client'
/* eslint-disable i18next/no-literal-string */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Modal } from './Modal'

type CommandItem = {
  id: string
  icon: ComponentType<{ className?: string }>
  label: string
  sub: string
  group?: string
  shortcut?: string
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
  const t = useTranslations('nav.commandPalette')
  const nav = useTranslations('nav.commands')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) =>
      `${item.label} ${item.sub} ${item.group ?? ''}`.toLowerCase().includes(q)
    )
  }, [items, query])
  const grouped = useMemo(() => {
    return filtered.reduce<Array<{ group: string; items: CommandItem[] }>>((acc, item) => {
      const group = item.group ?? nav('defaultGroup')
      const existing = acc.find((entry) => entry.group === group)
      if (existing) {
        existing.items.push(item)
      } else {
        acc.push({ group, items: [item] })
      }
      return acc
    }, [])
  }, [filtered, nav])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveIndex(0)
      return
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    const activeButton = itemRefs.current[activeIndex]
    activeButton?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  const runItem = (item: CommandItem) => {
    onClose()
    if (item.action) {
      item.action()
      return
    }
    if (item.href) router.push(item.href)
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabel={t('label')} className="cmd-palette-modal">
      <div className="cmd-palette-head">
        <span className="cmd-palette-icon">⌘</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (filtered.length > 0) {
                setActiveIndex((current) => Math.min(current + 1, filtered.length - 1))
              }
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((current) => Math.max(current - 1, 0))
            } else if (event.key === 'Enter' && filtered[activeIndex]) {
              runItem(filtered[activeIndex])
            } else if (event.key === 'Escape') {
              event.stopPropagation()
              onClose()
            }
          }}
          aria-activedescendant={filtered[activeIndex] ? `cmd-item-${filtered[activeIndex].id}` : undefined}
          placeholder={t('placeholder')}
          className="cmd-palette-input"
        />
        <kbd className="search-kbd">Esc</kbd>
      </div>
      <div className="cmd-palette-list">
        {grouped.map((group) => (
          <section key={group.group} className="cmd-group" aria-label={group.group}>
            <div className="cmd-group-label">{group.group}</div>
            {group.items.map((item) => {
              const Icon = item.icon
              const itemIndex = filtered.findIndex((filteredItem) => filteredItem.id === item.id)
              const isActive = itemIndex === activeIndex
              return (
                <button
                  key={item.id}
                  id={`cmd-item-${item.id}`}
                  ref={(node) => {
                    itemRefs.current[itemIndex] = node
                  }}
                  type="button"
                  className={`cmd-item${isActive ? ' is-active' : ''}`}
                  aria-current={isActive ? 'true' : undefined}
                  onMouseEnter={() => setActiveIndex(itemIndex)}
                  onClick={() => runItem(item)}
                >
                  <span className="cmd-item-icon" aria-hidden="true">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="cmd-item-copy">
                    <span className="cmd-item-label">{item.label}</span>
                    <span className="cmd-item-sub">{item.sub}</span>
                  </span>
                  {item.shortcut ? <kbd className="cmd-item-shortcut">{item.shortcut}</kbd> : null}
                </button>
              )
            })}
          </section>
        ))}
        {filtered.length === 0 ? (
          <div className="cmd-empty-state">
            <div className="empty-icon">⌁</div>
            <div className="empty-title">{t('emptyTitle')}</div>
            <div className="empty-sub">{t('emptySub')}</div>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
