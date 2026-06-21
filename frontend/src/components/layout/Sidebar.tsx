'use client'

import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FolderOpen,
  LayoutGrid,
  Radio,
  RadioTower,
  SatelliteDish,
  Settings,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'yt.dashboard.sidebar.collapsed'

export function readSidebarCollapsed() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(STORAGE_KEY) === '1'
}

export function writeSidebarCollapsed(value: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

type NavItem = {
  href: string
  icon: ComponentType<{ className?: string }>
  key: 'dashboard' | 'streaming' | 'library' | 'channels' | 'plans' | 'profile'
}

// IA restructure 2026-04-26:
//  • Track 4: dropped Дашборд (low-fidelity mirror of streams) and
//    Розклад (calendar-shaped redirector); both now redirect to
//    /dashboard/streaming.
//  • Track 5a: extracted Channels (RTMPS destinations) out of the
//    streaming page into its own route — setup-once concern that
//    deserves a dedicated surface so first-run users see it clearly.
const items: NavItem[] = [
  { href: '/dashboard', icon: LayoutGrid, key: 'dashboard' },
  { href: '/dashboard/streaming', icon: SatelliteDish, key: 'streaming' },
  { href: '/dashboard/library', icon: FolderOpen, key: 'library' },
  { href: '/dashboard/channels', icon: RadioTower, key: 'channels' },
  { href: '/dashboard/plans', icon: CreditCard, key: 'plans' },
  { href: '/dashboard/profile', icon: Settings, key: 'profile' },
] as const

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const nav = useTranslations('nav')

  return (
    <nav className="sidebar">
      <div className="nav-group">
        <Link
          href="/dashboard/streaming?new=1"
          className={cn('nav-go-live', collapsed && 'is-collapsed')}
          aria-label={nav('sidebar.goLive')}
          title={collapsed ? nav('sidebar.goLive') : undefined}
        >
          <span className="nav-icon" aria-hidden="true">
            <Radio className="h-5 w-5" />
          </span>
          <span className="nav-txt">
            <span className="nav-main">{nav('sidebar.goLive')}</span>
            <span className="nav-sub">{nav('sidebar.goLiveSub')}</span>
          </span>
        </Link>

        <div className="nav-label">{nav('sidebar.main')}</div>
        {items.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          const label = nav(`sidebar.items.${item.key}.label`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn('nav-item', active && 'active')}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? label : undefined}
            >
              <span className="nav-active-rail" aria-hidden="true" />
              <span className="nav-icon" aria-hidden="true">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="nav-txt">
                <span className="nav-main">{label}</span>
                <span className="nav-sub">{nav(`sidebar.items.${item.key}.sub`)}</span>
              </span>
            </Link>
          )
        })}
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-status" aria-hidden={collapsed}>
          <span className="sidebar-status-dot" />
          <span>
            <strong>{nav('sidebar.statusOnline')}</strong>
            <small>{nav('sidebar.statusReady')}</small>
          </span>
        </div>
        <button
          type="button"
          className="collapse-btn"
          onClick={onToggle}
          aria-label={collapsed ? nav('sidebar.expandLabel') : nav('sidebar.collapseLabel')}
          title={collapsed ? nav('sidebar.expandTitle') : undefined}
        >
          <span className="nav-icon" aria-hidden="true">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </span>
          <span className="nav-txt">
            <span className="nav-main">{nav('sidebar.collapse')}</span>
          </span>
        </button>
      </div>
    </nav>
  )
}
