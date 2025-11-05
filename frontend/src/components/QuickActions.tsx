'use client'

import { motion } from 'framer-motion'
import { Upload, Play, ListPlus, TvMinimal, Settings, BarChart3 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card'
import { useRouter } from 'next/navigation'

interface QuickAction {
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  action: () => void
  gradient: string
}

export function QuickActions() {
  const router = useRouter()

  const actions: QuickAction[] = [
    {
      label: 'Upload Video',
      description: 'Add new video to library',
      icon: Upload,
      action: () => router.push('/dashboard/library?tab=assets'),
      gradient: 'from-blue-500 to-cyan-500',
    },
    {
      label: 'Go Live',
      description: 'Start streaming now',
      icon: Play,
      action: () => router.push('/dashboard/streaming'),
      gradient: 'from-purple-500 to-pink-500',
    },
    {
      label: 'Create Playlist',
      description: 'Build a new playlist',
      icon: ListPlus,
      action: () => router.push('/dashboard/library?tab=playlists'),
      gradient: 'from-amber-500 to-orange-500',
    },
    {
      label: 'Add Channel',
      description: 'Connect YouTube channel',
      icon: TvMinimal,
      action: () => router.push('/dashboard/streaming'),
      gradient: 'from-emerald-500 to-green-500',
    },
    {
      label: 'View Library',
      description: 'Browse videos & playlists',
      icon: BarChart3,
      action: () => router.push('/dashboard/library'),
      gradient: 'from-indigo-500 to-violet-500',
    },
    {
      label: 'Manage Streams',
      description: 'Control live streams',
      icon: Settings,
      action: () => router.push('/dashboard/streaming'),
      gradient: 'from-slate-500 to-slate-600',
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {actions.map((action, index) => {
            const Icon = action.icon
            return (
              <motion.button
                key={action.label}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={action.action}
                className="group relative flex items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all bg-white dark:bg-slate-800/50 overflow-hidden p-4"
              >
                {/* Gradient background on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${action.gradient} opacity-0 group-hover:opacity-5 transition-opacity`} />
                <div className="relative flex w-full items-center gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${action.gradient} shadow-lg group-hover:shadow-xl transition-shadow`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>

                  <div className="flex min-w-0 flex-col text-left">
                    <h3 className="font-semibold text-base text-slate-900 dark:text-white">
                      {action.label}
                    </h3>

                    <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                      {action.description}
                    </p>
                  </div>
                </div>
              </motion.button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
