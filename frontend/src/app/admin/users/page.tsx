'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { 
  Users, Search, Filter, TrendingUp, 
  ChevronRight, Ban, CheckCircle, Settings 
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

export default function UsersManagement() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTier, setFilterTier] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const queryClient = useQueryClient()

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['admin-users', filterTier, filterStatus],
    queryFn: () => api.admin.users.list({
      tier: filterTier !== 'all' ? filterTier : undefined,
      is_suspended: filterStatus === 'suspended' ? true : filterStatus === 'active' ? false : undefined,
    }),
    refetchInterval: 10000,
  })

  const suspendMutation = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) => 
      api.admin.users.suspend(userId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('User suspended successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to suspend user')
    },
  })

  const unsuspendMutation = useMutation({
    mutationFn: (userId: string) => api.admin.users.unsuspend(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('User unsuspended successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to unsuspend user')
    },
  })

  const handleSuspend = (userId: string) => {
    const reason = prompt('Enter suspension reason:')
    if (reason) {
      suspendMutation.mutate({ userId, reason })
    }
  }

  const handleUnsuspend = (userId: string) => {
    if (confirm('Are you sure you want to unsuspend this user?')) {
      unsuspendMutation.mutate(userId)
    }
  }

  const getTierBadgeColor = (tier: string) => {
    switch (tier) {
      case 'enterprise': return 'from-amber-500 to-orange-600'
      case 'business': return 'from-accent-500 to-cyan-600'
      case 'pro': return 'from-primary-500 to-purple-600'
      default: return 'from-slate-500 to-slate-600'
    }
  }

  const filteredUsers = (usersData || []).filter(user => {
    const matchesSearch = user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (user.full_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">User Management</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Manage user accounts and subscriptions
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="secondary" size="sm">
            <Filter className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold">{usersData?.length || 0}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Total Users</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-success-600">
                {usersData?.filter(u => !u.is_suspended).length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Active</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-error-600">
                {usersData?.filter(u => u.is_suspended).length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Suspended</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-primary-600">
                {usersData?.filter(u => ['pro', 'business', 'enterprise'].includes(u.subscription_tier)).length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Paid Plans</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search users by email or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* Tier Filter */}
            <select
              value={filterTier}
              onChange={(e) => setFilterTier(e.target.value)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Tiers</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="business">Business</option>
              <option value="enterprise">Enterprise</option>
            </select>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>Users ({filteredUsers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-slate-500">Loading users...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 mx-auto text-slate-400 mb-4" />
              <p className="text-slate-600 dark:text-slate-400">No users found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredUsers.map((user, index) => (
                <motion.div
                  key={user.user_id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={cn(
                    'p-4 rounded-lg border transition-all',
                    user.is_suspended
                      ? 'border-error-200 dark:border-error-800 bg-error-50 dark:bg-error-900/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="font-semibold text-lg">{user.full_name || 'N/A'}</h3>
                        <Badge
                          variant="secondary"
                          className={`bg-gradient-to-r ${getTierBadgeColor(user.subscription_tier)} text-white border-0 capitalize`}
                        >
                          {user.subscription_tier}
                        </Badge>
                        {user.is_suspended && (
                          <Badge variant="error" className="flex items-center space-x-1">
                            <Ban className="w-3 h-3" />
                            <span>Suspended</span>
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{user.email}</p>

                      {/* Usage Stats */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-slate-500 dark:text-slate-400 mb-1">Storage Used</p>
                          <p className="font-medium">{(user.current_storage_bytes / (1024 ** 3)).toFixed(2)} GB</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400 mb-1">Stream Hours</p>
                          <p className="font-medium">{user.total_stream_hours.toFixed(1)} hrs</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400 mb-1">Status</p>
                          <p className="font-medium">{user.subscription_status}</p>
                        </div>
                      </div>

                      {/* Metadata */}
                      <div className="mt-3 flex items-center space-x-4 text-xs text-slate-500 dark:text-slate-400">
                        <span>Joined: {formatDistanceToNow(new Date(user.created_at), { addSuffix: true })}</span>
                        {user.last_login_at && (
                          <>
                            <span>•</span>
                            <span>Last login: {formatDistanceToNow(new Date(user.last_login_at), { addSuffix: true })}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col space-y-2 ml-4">
                      {user.is_suspended ? (
                        <Button 
                          size="sm" 
                          variant="success" 
                          className="flex items-center space-x-2"
                          onClick={() => handleUnsuspend(user.user_id)}
                          disabled={unsuspendMutation.isPending}
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>Unsuspend</span>
                        </Button>
                      ) : (
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          className="flex items-center space-x-2"
                          onClick={() => handleSuspend(user.user_id)}
                          disabled={suspendMutation.isPending}
                        >
                          <Ban className="w-4 h-4" />
                          <span>Suspend</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
