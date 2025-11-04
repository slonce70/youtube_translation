'use client'

import { motion } from 'framer-motion'
import { Users, Radio, AlertTriangle, Activity, Database } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { StatCard } from '@/components/StatCard'
import { Badge } from '@/components/ui/Badge'
import { api } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'

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

  const stats = {
    totalUsers: users?.length || 0,
    activeUsers: users?.filter(u => !u.is_suspended).length || 0,
    suspendedUsers: users?.filter(u => u.is_suspended).length || 0,
    totalStreams: streams?.length || 0,
    activeStreams: streams?.filter(s => s.status === 'running').length || 0,
    errorStreams: streams?.filter(s => s.status === 'error').length || 0,
    unresolvedAlerts: alerts?.length || 0,
    criticalAlerts: alerts?.filter(a => a.severity === 'critical').length || 0,
    storageUsed: (users || []).reduce((sum, u) => sum + u.current_storage_bytes, 0) / (1024 ** 4),
    storageTotal: 10,
  }

  const recentUsers = users?.slice(0, 3) || []
  const recentAlerts = alerts?.slice(0, 3) || []

  const isLoading = usersLoading || streamsLoading || alertsLoading

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold gradient-text mb-2">Admin Dashboard</h2>
        <p className="text-slate-600 dark:text-slate-400">
          System overview and monitoring
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Users"
          value={stats.totalUsers}
          icon={Users}
          gradient="from-blue-500 to-cyan-500"
          delay={0}
        />
        <StatCard
          title="Active Streams"
          value={stats.activeStreams}
          icon={Radio}
          gradient="from-purple-500 to-pink-500"
          delay={0.1}
        />
        <StatCard
          title="Unresolved Alerts"
          value={stats.unresolvedAlerts}
          icon={AlertTriangle}
          gradient="from-amber-500 to-orange-500"
          delay={0.2}
        />
        <StatCard
          title="System Health"
          value="98%"
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
              <span>User Statistics</span>
              <Users className="w-5 h-5 text-slate-400" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Total Users</span>
                <span className="text-2xl font-bold">{stats.totalUsers}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Active Users</span>
                <span className="text-2xl font-bold text-success-600">{stats.activeUsers}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Suspended</span>
                <span className="text-2xl font-bold text-error-600">{stats.suspendedUsers}</span>
              </div>

              {/* Progress Bar */}
              <div className="pt-2">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>User Activity</span>
                  <span>{((stats.activeUsers / stats.totalUsers) * 100).toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(stats.activeUsers / stats.totalUsers) * 100}%` }}
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
              <span>Stream Statistics</span>
              <Radio className="w-5 h-5 text-slate-400" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Total Streams</span>
                <span className="text-2xl font-bold">{stats.totalStreams}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Active Now</span>
                <span className="text-2xl font-bold text-success-600">{stats.activeStreams}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-400">Errors</span>
                <span className="text-2xl font-bold text-error-600">{stats.errorStreams}</span>
              </div>

              {/* Progress Bar */}
              <div className="pt-2">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Stream Usage</span>
                  <span>{((stats.activeStreams / stats.totalStreams) * 100).toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(stats.activeStreams / stats.totalStreams) * 100}%` }}
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
            <CardTitle>Recent Users</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-slate-500">Loading...</div>
            ) : recentUsers.length === 0 ? (
              <div className="text-center py-8 text-slate-500">No users yet</div>
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
                        Signed up {formatDistanceToNow(new Date(user.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant="secondary" className="capitalize">
                        {user.subscription_tier}
                      </Badge>
                      <Badge variant={!user.is_suspended ? 'success' : 'error'}>
                        {user.is_suspended ? 'suspended' : 'active'}
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
            <CardTitle>Recent Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-slate-500">Loading...</div>
            ) : recentAlerts.length === 0 ? (
              <div className="text-center py-8 text-slate-500">No alerts</div>
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
                        <AlertTriangle className={`w-4 h-4 ${
                          alert.severity === 'critical' ? 'text-error-600' : 'text-warning-600'
                        }`} />
                        <p className="font-medium">{alert.alert_type.replace(/_/g, ' ')}</p>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {alert.user_email} • {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <Badge variant={alert.severity === 'critical' ? 'error' : 'warning'}>
                      {alert.severity}
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
            <span>System Resources</span>
            <Database className="w-5 h-5 text-slate-400" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Storage */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600 dark:text-slate-400">Storage Usage</span>
                <span className="font-medium">
                  {stats.storageUsed} TB / {stats.storageTotal} TB
                </span>
              </div>
              <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(stats.storageUsed / stats.storageTotal) * 100}%` }}
                  transition={{ duration: 1 }}
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-500"
                />
              </div>
            </div>

            {/* Quick Actions */}
            <div className="pt-4 flex flex-wrap gap-2">
              <button className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                View All Users
              </button>
              <button className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                Monitor Streams
              </button>
              <button className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                Resolve Alerts
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
