'use client'

import {
  Copy,
  CreditCard,
  FolderOpen,
  Play,
  Radio,
  RadioTower,
  SatelliteDish,
  Square,
  UploadCloud,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Stream } from '@/lib/types'
import { useDashboardContext } from '@/app/dashboard/dashboard-context'
import { CommandPalette, type CommandItem as CommandPaletteItem } from '@/components/ui/CommandPalette'
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
  const queryClient = useQueryClient()
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

  const commandItems = useMemo<CommandPaletteItem[]>(
    () => {
      const actionsGroup = nav('commands.actionsGroup')
      // Static nav + quick-action entries. IA restructure 2026-04-26: dropped
      // Dashboard + Schedule entries (their pages now redirect to /streaming).
      // Track 5a added Channels.
      const staticItems: CommandPaletteItem[] = [
        { id: 'streaming', icon: SatelliteDish, label: nav('sidebar.items.streaming.label'), sub: nav('commands.items.streamingSub'), href: '/dashboard/streaming', group: nav('commands.navigationGroup'), shortcut: 'G S' },
        { id: 'library', icon: FolderOpen, label: nav('sidebar.items.library.label'), sub: nav('commands.items.librarySub'), href: '/dashboard/library', group: nav('commands.navigationGroup'), shortcut: 'G F' },
        { id: 'channels', icon: RadioTower, label: nav('sidebar.items.channels.label'), sub: nav('commands.items.channelsSub'), href: '/dashboard/channels', group: nav('commands.navigationGroup'), shortcut: 'G C' },
        { id: 'plans', icon: CreditCard, label: nav('sidebar.items.plans.label'), sub: nav('commands.items.plansSub'), href: '/dashboard/plans', group: nav('commands.navigationGroup'), shortcut: 'G P' },
        { id: 'new-stream', icon: Radio, label: nav('commands.items.newStream'), sub: nav('commands.items.newStreamSub'), href: '/dashboard/streaming?new=1', group: actionsGroup, shortcut: 'N' },
        { id: 'upload', icon: UploadCloud, label: nav('commands.items.upload'), sub: nav('commands.items.uploadSub'), href: '/dashboard/library?tab=assets', group: actionsGroup, shortcut: 'U' },
      ]

      const streamList = streams ?? []
      if (streamList.length === 0) {
        return staticItems
      }

      const derived = streamList.map((stream) => ({
        stream,
        state: deriveStreamState(stream),
        name: stream.name?.trim() || (stream.id.slice(0, 8)),
      }))
      const runningStreams = derived.filter((entry) => entry.state.isRunning)

      const invalidateStreams = () => queryClient.invalidateQueries({ queryKey: ['streams'] })

      const dynamicItems: CommandPaletteItem[] = []

      // Bound per-verb item count so a large account doesn't drown the palette.
      // Bulk stop is still available via the "stop all" entry below.
      const MAX_PER_VERB = 8

      // 1. Stop verbs for each running stream.
      runningStreams.slice(0, MAX_PER_VERB).forEach(({ stream, name }) => {
        dynamicItems.push({
          id: `stop-stream-${stream.id}`,
          icon: Square,
          label: nav('commands.stopStreamNamed', { name }),
          sub: nav('commands.stopStreamNamedSub'),
          group: actionsGroup,
          action: async () => {
            try {
              await api.streams.stop(stream.id)
              await invalidateStreams()
              toast.success(nav('commands.stoppedToast', { name }))
            } catch {
              toast.error(nav('commands.stopErrorToast'))
            }
          },
        })
      })

      // 2. Start verbs for each non-running stream (stopped/scheduled/etc.).
      derived
        .filter((entry) => !entry.state.isRunning)
        .slice(0, MAX_PER_VERB)
        .forEach(({ stream, name }) => {
          dynamicItems.push({
            id: `start-stream-${stream.id}`,
            icon: Play,
            label: nav('commands.startStreamNamed', { name }),
            sub: nav('commands.startStreamNamedSub'),
            group: actionsGroup,
            action: async () => {
              try {
                await api.streams.start(stream.id)
                await invalidateStreams()
                toast.success(nav('commands.startedToast', { name }))
              } catch {
                toast.error(nav('commands.startErrorToast'))
              }
            },
          })
        })

      // 3. Bulk "stop all live" when at least one stream is running.
      if (runningStreams.length > 0) {
        dynamicItems.push({
          id: 'stop-all-live',
          icon: Square,
          label: nav('commands.stopAllLive', { count: runningStreams.length }),
          sub: nav('commands.stopAllLiveSub'),
          group: actionsGroup,
          action: async () => {
            try {
              await Promise.all(runningStreams.map(({ stream }) => api.streams.stop(stream.id)))
              await invalidateStreams()
              toast.success(nav('commands.stoppedAllToast', { count: runningStreams.length }))
            } catch {
              toast.error(nav('commands.stopErrorToast'))
            }
          },
        })
      }

      // 4. Copy watch link for any stream with a resolved provider video id.
      derived
        .filter((entry) => Boolean(entry.stream.provider_video_id))
        .slice(0, MAX_PER_VERB)
        .forEach(({ stream, name }) => {
          dynamicItems.push({
            id: `copy-watch-${stream.id}`,
            icon: Copy,
            label: nav('commands.copyWatchLink', { name }),
            sub: nav('commands.copyWatchLinkSub'),
            group: actionsGroup,
            action: async () => {
              try {
                await navigator.clipboard.writeText(
                  `https://www.youtube.com/watch?v=${stream.provider_video_id}`,
                )
                toast.success(nav('commands.linkCopiedToast'))
              } catch {
                toast.error(nav('commands.copyErrorToast'))
              }
            },
          })
        })

      return [...staticItems, ...dynamicItems]
    },
    [nav, streams, queryClient],
  )

  return (
    <div className="dashboard-v2">
      <a href="#main-content" className="skip-link">{nav('skipToContent')}</a>
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
        <main className="main" id="main-content">
          <div className="page active">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commandItems} />
    </div>
  )
}
