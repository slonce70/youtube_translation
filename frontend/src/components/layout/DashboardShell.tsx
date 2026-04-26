'use client'

import {
  CreditCard,
  FolderOpen,
  Radio,
  SatelliteDish,
  UploadCloud,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
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
  const nav = useTranslations('nav')
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
      // IA restructure 2026-04-26: dropped Dashboard + Schedule entries
      // (their pages now redirect to /streaming).
      { id: 'streaming', icon: SatelliteDish, label: nav('sidebar.items.streaming.label'), sub: nav('commands.items.streamingSub'), href: '/dashboard/streaming', group: nav('commands.navigationGroup'), shortcut: 'G S' },
      { id: 'library', icon: FolderOpen, label: nav('sidebar.items.library.label'), sub: nav('commands.items.librarySub'), href: '/dashboard/library', group: nav('commands.navigationGroup'), shortcut: 'G F' },
      { id: 'plans', icon: CreditCard, label: nav('sidebar.items.plans.label'), sub: nav('commands.items.plansSub'), href: '/dashboard/plans', group: nav('commands.navigationGroup'), shortcut: 'G P' },
      { id: 'new-stream', icon: Radio, label: nav('commands.items.newStream'), sub: nav('commands.items.newStreamSub'), href: '/dashboard/streaming?new=1', group: nav('commands.actionsGroup'), shortcut: 'N' },
      { id: 'upload', icon: UploadCloud, label: nav('commands.items.upload'), sub: nav('commands.items.uploadSub'), href: '/dashboard/library?tab=assets', group: nav('commands.actionsGroup'), shortcut: 'U' },
    ] satisfies Array<{
      id: string
      icon: LucideIcon
      label: string
      sub: string
      href: string
      group: string
      shortcut: string
    }>,
    [nav],
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
