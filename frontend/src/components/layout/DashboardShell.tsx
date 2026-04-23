'use client'

import {
  CalendarDays,
  CreditCard,
  FolderOpen,
  Gauge,
  Radio,
  SatelliteDish,
  UploadCloud,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import type { Stream } from '@/lib/types'
import { useDashboardContext } from '@/app/dashboard/dashboard-context'
import { CommandPalette } from '@/components/ui/CommandPalette'
import { deriveStreamState } from '@/lib/stream-state'
import { Sidebar, readSidebarCollapsed, writeSidebarCollapsed } from './Sidebar'
import { Topbar } from './Topbar'

interface DashboardShellProps {
  userName: string
  userEmail: string
  onSignOut: () => void
  children: React.ReactNode
}

export function DashboardShell({ userName, userEmail, onSignOut, children }: DashboardShellProps) {
  const { user } = useDashboardContext()
  const pathname = usePathname()
  const currentPath = pathname ?? ''
  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Dashboard routes own stream-data freshness. The shell only subscribes to shared cache state.
  const { data: streams } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id],
    queryFn: api.streams.list,
    enabled: false,
    staleTime: Infinity,
  })
  const showLiveBadge = currentPath === '/dashboard' || currentPath.startsWith('/dashboard/streaming')

  useEffect(() => {
    setCollapsed(readSidebarCollapsed())
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const liveCount = useMemo(
    () => (streams ?? []).filter((stream) => deriveStreamState(stream).isRunning).length,
    [streams],
  )

  const commandItems = useMemo(
    () => [
      { id: 'dashboard', icon: Gauge, label: 'Дашборд', sub: 'Головна панель', href: '/dashboard', group: 'Навігація', shortcut: 'G D' },
      { id: 'library', icon: FolderOpen, label: 'Файли', sub: 'Бібліотека та плейлисти', href: '/dashboard/library', group: 'Навігація', shortcut: 'G F' },
      { id: 'streaming', icon: SatelliteDish, label: 'Трансляції', sub: 'Канали, live та архів', href: '/dashboard/streaming', group: 'Навігація', shortcut: 'G S' },
      { id: 'plans', icon: CreditCard, label: 'Тарифи', sub: 'Плани та ліміти', href: '/dashboard/plans', group: 'Навігація', shortcut: 'G P' },
      { id: 'schedule', icon: CalendarDays, label: 'Розклад', sub: 'Заплановані запуски', href: '/dashboard/schedule', group: 'Навігація', shortcut: 'G C' },
      { id: 'new-stream', icon: Radio, label: 'Нова трансляція', sub: 'Відкрити запуск стріму', href: '/dashboard/streaming?new=1', group: 'Швидкі дії', shortcut: 'N' },
      { id: 'upload', icon: UploadCloud, label: 'Завантажити файл', sub: 'Перейти до бібліотеки', href: '/dashboard/library?tab=assets', group: 'Швидкі дії', shortcut: 'U' },
    ] satisfies Array<{
      id: string
      icon: LucideIcon
      label: string
      sub: string
      href: string
      group: string
      shortcut: string
    }>,
    [],
  )

  return (
    <div className="dashboard-v2">
      <div className={`dashboard-app${collapsed ? ' nav-collapsed' : ''}`}>
        <Topbar
          userName={userName}
          userEmail={userEmail}
          liveCount={liveCount}
          showLiveBadge={showLiveBadge}
          onOpenPalette={() => setPaletteOpen(true)}
          onSignOut={onSignOut}
        />
        <Sidebar
          collapsed={collapsed}
          onToggle={() => {
            const next = !collapsed
            setCollapsed(next)
            writeSidebarCollapsed(next)
          }}
        />
        <main className="main">
          <div className="page active">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commandItems} />
    </div>
  )
}
