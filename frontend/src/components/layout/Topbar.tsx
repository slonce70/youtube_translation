'use client'
/* eslint-disable i18next/no-literal-string */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, ChevronDown, CreditCard, LogOut, Search, Settings, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { LiveDot } from '@/components/ui/LiveDot'

interface TopbarProps {
  userName: string
  userEmail: string
  liveCount: number
  showLiveBadge?: boolean
  onOpenPalette: () => void
  onSignOut: () => void
}

export function Topbar({
  userName,
  userEmail,
  liveCount,
  showLiveBadge = true,
  onOpenPalette,
  onSignOut,
}: TopbarProps) {
  const nav = useTranslations('nav')
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const brandName = process.env.NEXT_PUBLIC_APP_NAME || nav('brand.name')
  const displayName = userName || userEmail || nav('profile.fallbackName')
  const initial = displayName.charAt(0).toUpperCase()

  useEffect(() => {
    if (!menuOpen) return
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const liveLabel = useMemo(() => {
    if (liveCount <= 0) return 'Немає live'
    return `${liveCount} Live`
  }, [liveCount])

  return (
    <header className="topbar">
      <div className="topbar-logo">
        <div className="logo-icon">📡</div>
        <span className="logo-text">{brandName}</span>
      </div>

      <button
        type="button"
        className="topbar-search"
        onClick={onOpenPalette}
        aria-label="Відкрити пошук команд"
      >
        <Search className="topbar-search-icon" aria-hidden="true" />
        <span className="topbar-search-input" aria-hidden="true">Пошук або ⌘K…</span>
        <span className="search-kbd">⌘K</span>
      </button>

      {showLiveBadge ? (
        <button
          type="button"
          className="topbar-live-badge"
          onClick={() => router.push('/dashboard/streaming')}
        >
          <LiveDot />
          {liveLabel}
        </button>
      ) : null}

      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn"
          onClick={() => toast.info('Немає нових сповіщень')}
          aria-label="Сповіщення"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          <span className="notif-badge" />
        </button>

        <div className="topbar-user" ref={menuRef}>
          <button
            type="button"
            className="user-btn"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Відкрити меню користувача ${displayName}`}
          >
            <div className="avatar">{initial}</div>
            <span className="user-name">{displayName}</span>
            <ChevronDown className="user-chevron" aria-hidden="true" />
          </button>

          {menuOpen ? (
            <div
              className="topbar-menu"
              role="menu"
              aria-label="Меню користувача"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setMenuOpen(false)
                }
              }}
            >
              <div className="topbar-menu-head">
                <div className="topbar-menu-avatar">{initial}</div>
                <div className="topbar-menu-identity">
                  <div className="topbar-menu-name">{displayName}</div>
                  <div className="topbar-menu-email">{userEmail}</div>
                </div>
                <span className="topbar-plan-chip">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Free
                </span>
              </div>
              <Link href="/dashboard/profile" className="topbar-menu-item" onClick={() => setMenuOpen(false)} role="menuitem">
                <span className="topbar-menu-icon" aria-hidden="true"><Settings className="h-4 w-4" /></span>
                <span>
                  <span className="topbar-menu-label">{nav('profile.accountSettings')}</span>
                  <span className="topbar-menu-sub">Профіль, канали, ключі</span>
                </span>
              </Link>
              <Link href="/dashboard/plans" className="topbar-menu-item" onClick={() => setMenuOpen(false)} role="menuitem">
                <span className="topbar-menu-icon" aria-hidden="true"><CreditCard className="h-4 w-4" /></span>
                <span>
                  <span className="topbar-menu-label">{nav('profile.managePlan')}</span>
                  <span className="topbar-menu-sub">Ліміти та місткість</span>
                </span>
              </Link>
              <button
                type="button"
                className="topbar-menu-item topbar-menu-item-danger"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onSignOut()
                }}
              >
                <span className="topbar-menu-icon" aria-hidden="true"><LogOut className="h-4 w-4" /></span>
                <span>
                  <span className="topbar-menu-label">{nav('profile.signOut')}</span>
                  <span className="topbar-menu-sub">Завершити сесію</span>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
