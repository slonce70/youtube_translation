'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Radio, Search, Square, Eye, AlertCircle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

export default function StreamsMonitoring() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const queryClient = useQueryClient()

  const { data: streamsData, isLoading } = useQuery({
    queryKey: ['admin-streams', filterStatus],
    queryFn: () => api.admin.streams.listAll({
      status: filterStatus !== 'all' ? filterStatus : undefined,
    }),
    refetchInterval: 5000,
  })

  const forceStopMutation = useMutation({
    mutationFn: (streamId: string) => api.admin.streams.forceStop(streamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-streams'] })
      toast.success('Stream stopped successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to stop stream')
    },
  })

  const handleForceStop = (streamId: string, streamName: string) => {
    if (confirm(`Are you sure you want to force stop stream "${streamName}"?`)) {
      forceStopMutation.mutate(streamId)
    }
  }

  const filteredStreams = (streamsData || []).filter(stream => {
    const matchesSearch = stream.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         stream.user_email.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'success'
      case 'error': return 'error'
      case 'stopped': return 'secondary'
      default: return 'secondary'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold gradient-text mb-2">Streams Monitoring</h2>
        <p className="text-slate-600 dark:text-slate-400">
          Monitor all active streams across all users
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold">{streamsData?.length || 0}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Total Streams</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-success-600">
                {streamsData?.filter(s => s.status === 'running').length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Running</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-error-600">
                {streamsData?.filter(s => s.status === 'error').length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Errors</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-slate-600">
                {streamsData?.filter(s => s.status === 'stopped').length || 0}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Stopped</p>
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
                placeholder="Search streams by name or user..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Status</option>
              <option value="running">Running</option>
              <option value="error">Error</option>
              <option value="stopped">Stopped</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Streams List */}
      <Card>
        <CardHeader>
          <CardTitle>Streams ({filteredStreams.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-slate-500">Loading streams...</div>
          ) : filteredStreams.length === 0 ? (
            <div className="text-center py-12">
              <Radio className="w-16 h-16 mx-auto text-slate-400 mb-4" />
              <p className="text-slate-600 dark:text-slate-400">No streams found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredStreams.map((stream, index) => (
                <motion.div
                  key={stream.stream_id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={cn(
                    'p-4 rounded-lg border transition-all',
                    stream.status === 'error'
                      ? 'border-error-200 dark:border-error-800 bg-error-50 dark:bg-error-900/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="font-semibold text-lg">{stream.name}</h3>
                        <Badge variant={getStatusColor(stream.status)} className="flex items-center space-x-1">
                          {stream.status === 'running' && (
                            <span className="w-2 h-2 rounded-full bg-success-500 animate-pulse" />
                          )}
                          <span className="capitalize">{stream.status}</span>
                        </Badge>
                      </div>

                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        User: {stream.user_email}
                      </p>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">Playlist ID</p>
                          <p className="font-medium text-xs truncate">{stream.playlist_id}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">Destinations</p>
                          <p className="font-medium">{stream.destinations_count} channels</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">Started</p>
                          <p className="font-medium text-xs">
                            {stream.started_at 
                              ? formatDistanceToNow(new Date(stream.started_at), { addSuffix: true })
                              : 'Not started'}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">Created</p>
                          <p className="font-medium text-xs">
                            {formatDistanceToNow(new Date(stream.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col space-y-2 ml-4">
                      {stream.status === 'running' && (
                        <Button 
                          size="sm" 
                          variant="error" 
                          className="flex items-center space-x-2"
                          onClick={() => handleForceStop(stream.stream_id, stream.name)}
                          disabled={forceStopMutation.isPending}
                        >
                          <Square className="w-4 h-4" />
                          <span>Force Stop</span>
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
