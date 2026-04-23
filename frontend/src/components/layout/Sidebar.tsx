'use client'
/* eslint-disable i18next/no-literal-string */

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FolderOpen,
  Gauge,
  Radio,
  SatelliteDish,
  Settings,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
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
  label: string
  sub: string
}

const items: NavItem[] = [
  { href: '/dashboard', icon: Gauge, label: 'Дашборд', sub: 'Огляд системи' },
  { href: '/dashboard/streaming', icon: SatelliteDish, label: 'Трансляції', sub: 'Live та канали' },
  { href: '/dashboard/library', icon: FolderOpen, label: 'Файли', sub: 'Медіа й плейлисти' },
  { href: '/dashboard/schedule', icon: CalendarDays, label: 'Розклад', sub: 'Запуски ефірів' },
  { href: '/dashboard/plans', icon: CreditCard, label: 'Тарифи', sub: 'Ліміти та апгрейд' },
  { href: '/dashboard/profile', icon: Settings, label: 'Налаштування', sub: 'Акаунт і канали' },
] as const

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()

  return (
    <nav className="sidebar">
      <div className="nav-group">
        <Link
          href="/dashboard/streaming?new=1"
          className={cn('nav-go-live', collapsed && 'is-collapsed')}
          aria-label="Почати трансляцію"
          title={collapsed ? 'Почати трансляцію' : undefined}
        >
          <span className="nav-icon" aria-hidden="true">
            <Radio className="h-5 w-5" />
          </span>
          <span className="nav-txt">
            <span className="nav-main">Почати трансляцію</span>
            <span className="nav-sub">Швидкий запуск live</span>
          </span>
        </Link>

        <div className="nav-label">Головне</div>
        {items.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn('nav-item', active && 'active')}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-active-rail" aria-hidden="true" />
              <span className="nav-icon" aria-hidden="true">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="nav-txt">
                <span className="nav-main">{item.label}</span>
                <span className="nav-sub">{item.sub}</span>
              </span>
            </Link>
          )
        })}
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-status" aria-hidden={collapsed}>
          <span className="sidebar-status-dot" />
          <span>
            <strong>Studio online</strong>
            <small>Готово до ефіру</small>
          </span>
        </div>
        <button
          type="button"
          className="collapse-btn"
          onClick={onToggle}
          aria-label={collapsed ? 'Розгорнути навігацію' : 'Згорнути навігацію'}
          title={collapsed ? 'Розгорнути' : undefined}
        >
          <span className="nav-icon" aria-hidden="true">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </span>
          <span className="nav-txt">
            <span className="nav-main">Згорнути</span>
          </span>
        </button>
      </div>
    </nav>
  )
}
