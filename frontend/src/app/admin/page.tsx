'use client'

import { motion } from 'framer-motion'
import { Users, Radio, AlertTriangle, Activity, Database } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { StatCard } from '@/components/StatCard'
import { Badge } from '@/components/ui/Badge'
import { api } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { useTranslations } from 'next-intl'

export default function AdminDashboard() {
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.admin.users.list({ limit: 1000 }),
    refetchInterval: 30000,
  })

  const { data: streams, isLoading: streamsLoading } = useQuery({
    queryKey: ['admin-streams'],
    queryFn: () => api.admin.streams.listAll({ limit: 1000 }),
    refetchInterval: 30000,
  })

  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ['admin-alerts'],
    queryFn: () => api.admin.alerts.list({ resolved: false, limit: 1000 }),
    refetchInterval: 30000,
  })

  const tDashboard = useTranslations('admin.dashboard')
  const tUsers = useTranslations('admin.users')
  const tAlerts = useTranslations('admin.alerts')

  const stats = {
    totalUsers: users?.length ?? 0,
    activeUsers: users?.filter((u) => !u.is_suspended).length ?? 0,
    suspendedUsers: users?.filter((u) => u.is_suspended).length ?? 0,
    totalStreams: streams?.length ?? 0,
    activeStreams: streams?.filter((s) => s.status === 'running').length ?? 0,
    errorStreams: streams?.filter((s) => s.status === 'error').length ?? 0,
    unresolvedAlerts: alerts?.length ?? 0,
    criticalAlerts: alerts?.filter((a) => a.severity === 'critical').length ?? 0,
    storageUsed: (users ?? []).reduce((sum, u) => sum + u.current_storage_bytes, 0) / 1024 ** 4,
    storageTotal: 10,
  }

  const recentUsers = users?.slice(0, 3) ?? []
  const recentAlerts = alerts?.slice(0, 3) ?? []

  const isLoading = usersLoading || streamsLoading || alertsLoading

  const userActivityPercent = stats.totalUsers ? Math.round((stats.activeUsers / stats.totalUsers) * 100) : 0
  const streamUsagePercent = stats.totalStreams ? Math.round((stats.activeStreams / stats.totalStreams) * 100) : 0
  const storagePercent = stats.storageTotal ? Math.min(100, (stats.storageUsed / stats.storageTotal) * 100) : 0
  const systemHealthValue = Math.max(0, Math.min(100, 100 - stats.errorStreams * 5 - stats.criticalAlerts * 2))

  const formatTier = (tier?: string | null) => {
    if (!tier) {
      return tUsers('tiers.free')
    }
    const normalized = tier.toLowerCase()
    const knownTiers = ['free', 'pro', 'business', 'enterprise']
    return knownTiers.includes(normalized) ? tUsers(`tiers.${normalized}` as any) : tier
  }

  const formatStatusBadge = (suspended: boolean) =>
    suspended ? tDashboard('badges.suspended') : tDashboard('badges.active')

  const translateSeverity = (severity: string) => {
    const knownSeverities = ['critical', 'warning']
    return knownSeverities.includes(severity)
      ? tAlerts(`list.severity.${severity}` as any)
      : severity
  }

  const storageUsedFormatted = stats.storageUsed.toFixed(2)
  const storageTotalFormatted = stats.storageTotal.toFixed(0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold gradient-text mb-2">{tDashboard('header.title')}</h2>
        <p className="text-slate-600 dark:text-slate-400">
          {tDashboard('header.description')}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={tDashboard('stats.totalUsers')}
          value={stats.totalUsers}
          icon={Users}
          gradient="from-blue-500 to-cyan-500"
          delay={0}
        />
        <StatCard
          title={tDashboard('stats.activeStreams')}
          value={stats.activeStreams}
          icon={Radio}
          gradient="from-purple-500 to-pink-500"
          delay={0.1}
        />
        <StatCard
          title={tDashboard('stats.unresolvedAlerts')}
          value={stats.unresolvedAlerts}
          icon={AlertTriangle}
          gradient="from-amber-500 to-orange-500"
          delay={0.2}
        />
        <StatCard
          title={tDashboard('stats.systemHealth')}
          value={tDashboard('stats.systemHealthValue', { value: systemHealthValue })}
          icon={Activity}
          gradient="from-emerald-500 to-green-500"
          delay={0.3}
        />
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{tDashboard('userStats.title')}</span>
              <Users className="w-5 h-5 text-slate-400" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">{tDashboard('userStats.total')}</span>
                <span className="text-2xl font-bold">{stats.totalUsers}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">{tDashboard('userStats.active')}</span>
                <span className="text-2xl font-bold text-success-600">{stats.activeUsers}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">{tDashboard('userStats.suspended')}</span>
                <span className="text-2xl font-bold text-error-600">{stats.suspendedUsers}</span>
              </div>

              {/* Progress Bar */}
              <div className="pt-2">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{tDashboard('userStats.activityLabel')}</span>
                  <span>{tDashboard('userStats.activityPercent', { value: userActivityPercent })}</span>
                </div>
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${userActivityPercent}%` }}
                    transition={{ duration: 1 }}
                    className="h-full bg-gradient-to-r from-success-500 to-success-600"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stream Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{tDashboard('streamStats.title')}</span>
              <Radio className="w-5 h-5 text-slate-400" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">{tDashboard('streamStats.total')}</span>
                <span className="text-2xl font-bold">{stats.totalStreams}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">{tDashboard('streamStats.active')}</span>
                <span className="text-2xl font-bold text-success-600">{stats.activeStreams}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">{tDashboard('streamStats.errors')}</span>
                <span className="text-2xl font-bold text-error-600">{stats.errorStreams}</span>
              </div>

              {/* Progress Bar */}
              <div className="pt-2">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{tDashboard('streamStats.usageLabel')}</span>
                  <span>{tDashboard('streamStats.usagePercent', { value: streamUsagePercent })}</span>
                </div>
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${streamUsagePercent}%` }}
                    transition={{ duration: 1 }}
                    className="h-full bg-gradient-to-r from-purple-500 to-purple-600"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Users */}
        <Card>
          <CardHeader>
            <CardTitle>{tDashboard('recentUsers.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-slate-500">{tDashboard('recentUsers.loading')}</div>
            ) : recentUsers.length === 0 ? (
              <div className="text-center py-8 text-slate-500">{tDashboard('recentUsers.empty')}</div>
            ) : (
              <div className="space-y-3">
                {recentUsers.map((user) => (
                  <motion.div
                    key={user.user_id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{user.email}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {tDashboard('recentUsers.signedUp', {
                          time: formatDistanceToNow(new Date(user.created_at), { addSuffix: true }),
                        })}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant="secondary" className="capitalize">
                        {formatTier(user.subscription_tier)}
                      </Badge>
                      <Badge variant={!user.is_suspended ? 'success' : 'error'}>
                        {formatStatusBadge(user.is_suspended)}
                      </Badge>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Alerts */}
        <Card>
          <CardHeader>
            <CardTitle>{tDashboard('recentAlerts.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-slate-500">{tDashboard('recentAlerts.loading')}</div>
            ) : recentAlerts.length === 0 ? (
              <div className="text-center py-8 text-slate-500">{tDashboard('recentAlerts.empty')}</div>
            ) : (
              <div className="space-y-3">
                {recentAlerts.map((alert) => (
                  <motion.div
                    key={alert.alert_id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <AlertTriangle
                          className={`w-4 h-4 ${
                            alert.severity === 'critical' ? 'text-error-600' : 'text-warning-600'
                          }`}
                        />
                        <p className="font-medium">{alert.alert_type.replace(/_/g, ' ')}</p>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {tDashboard('recentAlerts.userTime', {
                          user: alert.user_email,
                          time: formatDistanceToNow(new Date(alert.created_at), { addSuffix: true }),
                        })}
                      </p>
                    </div>
                    <Badge variant={alert.severity === 'critical' ? 'error' : 'warning'}>
                      {translateSeverity(alert.severity)}
                    </Badge>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* System Resources */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{tDashboard('systemResources.title')}</span>
            <Database className="w-5 h-5 text-slate-400" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Storage */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600 dark:text-slate-400">{tDashboard('systemResources.storageUsage')}</span>
                <span className="font-medium">
                  {tDashboard('systemResources.storageSummary', {
                    used: storageUsedFormatted,
                    total: storageTotalFormatted,
                  })}
                </span>
              </div>
              <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${storagePercent}%` }}
                  transition={{ duration: 1 }}
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-500"
                />
              </div>
            </div>

            {/* Quick Actions */}
            <div className="pt-4 flex flex-wrap gap-2">
              <button className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                {tDashboard('systemResources.actions.viewUsers')}
              </button>
              <button className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                {tDashboard('systemResources.actions.monitorStreams')}
              </button>
              <button className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                {tDashboard('systemResources.actions.resolveAlerts')}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
