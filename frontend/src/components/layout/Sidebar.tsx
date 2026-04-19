'use client'
/* eslint-disable i18next/no-literal-string */

import { ChevronLeft, ChevronRight, Radio } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
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

const items = [
  { href: '/dashboard', icon: '🏠', label: 'Дашборд' },
  { href: '/dashboard/streaming', icon: '📡', label: 'Трансляції' },
  { href: '/dashboard/library', icon: '📁', label: 'Файли' },
  { href: '/dashboard/schedule', icon: '🗓️', label: 'Розклад' },
  { href: '/dashboard/plans', icon: '💳', label: 'Тарифи' },
  { href: '/dashboard/profile', icon: '⚙️', label: 'Налаштування' },
] as const

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()

  return (
    <nav className="sidebar">
      <div className="nav-group">
        <Link href="/dashboard/streaming?new=1" className={cn('nav-go-live', collapsed && 'is-collapsed')}>
          <span className="nav-icon" aria-hidden="true">
            <Radio className="h-5 w-5" />
          </span>
          <span className="nav-txt">Почати трансляцію</span>
        </Link>

        <div className="nav-label">Головне</div>
        {items.map((item) => {
          const active = pathname === item.href
          return (
            <Link key={item.href} href={item.href} className={cn('nav-item', active && 'active')}>
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-txt">{item.label}</span>
            </Link>
          )
        })}
      </div>

      <div className="sidebar-bottom">
        <button type="button" className="collapse-btn" onClick={onToggle}>
          <span className="nav-icon" aria-hidden="true">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </span>
          <span className="nav-txt">Згорнути</span>
        </button>
      </div>
    </nav>
  )
}
