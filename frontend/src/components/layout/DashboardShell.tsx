'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Stream } from '@/lib/types'
import { useDashboardContext } from '@/app/dashboard/dashboard-context'
import { CommandPalette } from '@/components/ui/CommandPalette'
import { countLiveProviders } from '@/lib/provider-status'
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
  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { data: streams } = useQuery<Stream[]>({
    queryKey: ['streams', user?.id],
    queryFn: api.streams.list,
    enabled: !!user,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  })

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
    () => countLiveProviders(streams ?? []),
    [streams],
  )

  const commandItems = useMemo(
    () => [
      { id: 'dashboard', icon: '🏠', label: 'Дашборд', sub: 'Головна панель', href: '/dashboard' },
      { id: 'library', icon: '📁', label: 'Файли', sub: 'Бібліотека та плейлисти', href: '/dashboard/library' },
      { id: 'streaming', icon: '📡', label: 'Трансляції', sub: 'Канали, live та архів', href: '/dashboard/streaming' },
      { id: 'plans', icon: '💳', label: 'Тарифи', sub: 'Плани та ліміти', href: '/dashboard/plans' },
      { id: 'new-stream', icon: '🎙️', label: 'Нова трансляція', sub: 'Відкрити запуск стріму', href: '/dashboard/streaming?new=1' },
      { id: 'upload', icon: '⬆️', label: 'Завантажити файл', sub: 'Перейти до бібліотеки', href: '/dashboard/library?tab=assets' },
    ],
    [],
  )

  return (
    <div className="dashboard-v2">
      <div className={`dashboard-app${collapsed ? ' nav-collapsed' : ''}`}>
        <Topbar
          userName={userName}
          userEmail={userEmail}
          liveCount={liveCount}
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
