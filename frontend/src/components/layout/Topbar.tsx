'use client'
/* eslint-disable i18next/no-literal-string */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
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
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
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

      <button type="button" className="topbar-search" onClick={onOpenPalette}>
        <span style={{ color: 'var(--txt-3)', fontSize: 15 }}>🔍</span>
        <input readOnly value="" placeholder="Пошук або ⌘K…" />
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
          aria-label="Notifications"
        >
          🔔
          <span className="notif-badge" />
        </button>

        <div className="topbar-user" ref={menuRef}>
          <button type="button" className="user-btn" onClick={() => setMenuOpen((prev) => !prev)}>
            <div className="avatar">{initial}</div>
            <span className="user-name">{displayName}</span>
            <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>▾</span>
          </button>

          {menuOpen ? (
            <div className="topbar-menu">
              <div className="topbar-menu-head">
                <div className="topbar-menu-name">{displayName}</div>
                <div className="topbar-menu-email">{userEmail}</div>
              </div>
              <Link href="/dashboard/profile" className="topbar-menu-item" onClick={() => setMenuOpen(false)}>
                ⚙️ {nav('profile.accountSettings')}
              </Link>
              <Link href="/dashboard/plans" className="topbar-menu-item" onClick={() => setMenuOpen(false)}>
                💳 {nav('profile.managePlan')}
              </Link>
              <button
                type="button"
                className="topbar-menu-item topbar-menu-item-danger"
                onClick={() => {
                  setMenuOpen(false)
                  onSignOut()
                }}
              >
                🚪 {nav('profile.signOut')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
