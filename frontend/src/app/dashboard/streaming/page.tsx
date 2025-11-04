'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import {
  Radio,
  Play,
  Square,
  Trash2,
  ListMusic,
  Plus,
  Loader2,
  Activity,
  X,
  TvMinimal,
  Edit,
  Eye,
  EyeOff,
  Settings,
} from 'lucide-react'
import { motion } from 'framer-motion'

import { api } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import type {
  Playlist,
  Destination,
  DestinationUpdatePayload,
  Stream,
  StreamLogsResponse,
  CreateStreamPayload,
  StreamStatusValue,
} from '@/lib/types'
import { useDashboardContext } from '../dashboard-context'

type StreamFormState = {
  name: string
  playlist_id: string
  destination_ids: string[]
}

type DestinationFormState = {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
}

const statusVariantMap: Record<StreamStatusValue, 'success' | 'info' | 'warning' | 'error'> = {
  running: 'success',
  stopped: 'info',
  starting: 'warning',
  stopping: 'warning',
  error: 'error',
}

const statusLabelMap: Record<StreamStatusValue, string> = {
  running: 'Live',
  stopped: 'Stopped',
  starting: 'Starting',
  stopping: 'Stopping',
  error: 'Error',
}

export default function StreamingPage() {
  const queryClient = useQueryClient()
  const { user } = useDashboardContext()

  // Channels (Destinations) state
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [channelForm, setChannelForm] = useState<DestinationFormState>({
    name: '',
    rtmps_url: 'rtmps://a.rtmp.youtube.com/live2',
    stream_key: '',
    enabled: true,
  })

  // Streams state
  const [viewingLogs, setViewingLogs] = useState<string | null>(null)
  const [showCreateStream, setShowCreateStream] = useState(false)
  const [streamForm, setStreamForm] = useState<StreamFormState>({
    name: '',
    playlist_id: '',
    destination_ids: [],
  })

  // API Queries
  const { data: destinations, isLoading: isLoadingDestinations } = useQuery<Destination[]>({
    queryKey: ['destinations'],
    queryFn: () => api.destinations.list(),
    enabled: !!user,
  })

  const { data: streams, isLoading: isLoadingStreams } = useQuery<Stream[]>({
    queryKey: ['streams'],
    queryFn: () => api.streams.list(),
    enabled: !!user,
    refetchInterval: 3000,
  })

  const { data: playlists } = useQuery<Playlist[]>({
    queryKey: ['playlists'],
    queryFn: () => api.playlists.list(),
    enabled: !!user,
  })

  const { data: logsResponse } = useQuery<StreamLogsResponse>({
    queryKey: ['stream-logs', viewingLogs],
    queryFn: () => api.streams.logs(viewingLogs!, 200),
    enabled: !!viewingLogs,
    refetchInterval: 2000,
  })

  const playlistMap = useMemo(() => {
    if (!playlists) return new Map<string, Playlist>()
    return new Map(playlists.map((playlist) => [playlist.id, playlist]))
  }, [playlists])

  const enabledDestinations = useMemo(
    () => (destinations || []).filter((destination) => destination.enabled),
    [destinations]
  )

  useEffect(() => {
    if (playlists && playlists.length > 0 && !streamForm.playlist_id) {
      setStreamForm((prev) => ({ ...prev, playlist_id: playlists[0].id }))
    }
  }, [playlists, streamForm.playlist_id])

  useEffect(() => {
    if (enabledDestinations.length > 0 && streamForm.destination_ids.length === 0) {
      setStreamForm((prev) => ({ ...prev, destination_ids: [enabledDestinations[0].id] }))
    }
  }, [enabledDestinations, streamForm.destination_ids.length])

  // Destination Mutations
  const createDestinationMutation = useMutation({
    mutationFn: (data: DestinationFormState) => api.destinations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations'] })
      toast.success('Channel created')
      resetChannelForm()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const updateDestinationMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DestinationFormState }) => {
      const payload: DestinationUpdatePayload = {
        name: data.name,
        rtmps_url: data.rtmps_url,
        enabled: data.enabled,
      }
      if (data.stream_key.trim()) {
        payload.stream_key = data.stream_key.trim()
      }
      return api.destinations.update(id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations'] })
      toast.success('Channel updated')
      resetChannelForm()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const deleteDestinationMutation = useMutation({
    mutationFn: (destinationId: string) => api.destinations.delete(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations'] })
      toast.success('Channel deleted')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  // Stream Mutations
  const createStreamMutation = useMutation({
    mutationFn: (data: StreamFormState) => {
      const payload: CreateStreamPayload = { ...data }
      return api.streams.create(payload)
    },
    onSuccess: () => {
      toast.success('Stream created')
      queryClient.invalidateQueries({ queryKey: ['streams'] })
      resetStreamForm()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const startStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.start(streamId),
    onSuccess: () => {
      toast.success('Stream started')
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const stopStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.stop(streamId),
    onSuccess: () => {
      toast.info('Stream stopped')
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const deleteStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.delete(streamId),
    onSuccess: (_, streamId) => {
      toast.success('Stream deleted')
      if (viewingLogs === streamId) {
        setViewingLogs(null)
      }
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  // Handlers
  const resetChannelForm = () => {
    setChannelForm({
      name: '',
      rtmps_url: 'rtmps://a.rtmp.youtube.com/live2',
      stream_key: '',
      enabled: true,
    })
    setEditingChannelId(null)
    setShowChannelForm(false)
  }

  const resetStreamForm = () => {
    setStreamForm({ name: '', playlist_id: '', destination_ids: [] })
    setShowCreateStream(false)
  }

  const handleSubmitChannel = (event: React.FormEvent) => {
    event.preventDefault()
    if (editingChannelId) {
      updateDestinationMutation.mutate({ id: editingChannelId, data: channelForm })
    } else {
      createDestinationMutation.mutate(channelForm)
    }
  }

  const handleEditChannel = (destination: Destination) => {
    setEditingChannelId(destination.id)
    setChannelForm({
      name: destination.name,
      rtmps_url: destination.rtmps_url,
      stream_key: '',
      enabled: destination.enabled,
    })
    setShowChannelForm(true)
  }

  const handleDeleteChannel = (destinationId: string) => {
    if (confirm('Are you sure you want to delete this channel?')) {
      deleteDestinationMutation.mutate(destinationId)
    }
  }

  const handleSubmitStream = (event: React.FormEvent) => {
    event.preventDefault()

    if (!streamForm.playlist_id) {
      toast.error('Select a playlist')
      return
    }

    if (streamForm.destination_ids.length === 0) {
      toast.error('Select at least one destination')
      return
    }

    createStreamMutation.mutate(streamForm)
  }

  const toggleDestination = (destinationId: string) => {
    setStreamForm((prev) =>
      prev.destination_ids.includes(destinationId)
        ? { ...prev, destination_ids: prev.destination_ids.filter((id) => id !== destinationId) }
        : { ...prev, destination_ids: [...prev.destination_ids, destinationId] }
    )
  }

  const renderStatusBadge = (status: StreamStatusValue) => (
    <Badge variant={statusVariantMap[status]}>{statusLabelMap[status]}</Badge>
  )

  if (!user) {
    return <LoadingState text="Loading streaming..." />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">Streaming</h2>
          <p className="text-slate-600 dark:text-slate-400">Manage channels and live streams</p>
        </div>
        <Button onClick={() => setShowCreateStream(true)} className="flex items-center space-x-2">
          <Play className="w-4 h-4" />
          <span>Go Live</span>
        </Button>
      </div>

      {/* Main Layout: Channels Sidebar + Streams Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Channels Sidebar */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center space-x-2">
                <TvMinimal className="w-5 h-5" />
                <CardTitle className="text-base">Channels</CardTitle>
              </div>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setShowChannelForm(true)}>
                <Plus className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoadingDestinations ? (
                <LoadingState />
              ) : destinations && destinations.length > 0 ? (
                <>
                  {destinations.map((destination) => (
                    <motion.div key={destination.id} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                      <div
                        onClick={() => setSelectedChannel(destination.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedChannel(destination.id)
                          }
                        }}
                        className={cn(
                          'w-full text-left p-3 rounded-lg border transition-all cursor-pointer',
                          selectedChannel === destination.id
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{destination.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-1">
                              {destination.rtmps_url.split('/').pop()}
                            </p>
                          </div>
                          <Badge variant={destination.enabled ? 'success' : 'secondary'} className="ml-2">
                            {destination.enabled ? 'Active' : 'Disabled'}
                          </Badge>
                        </div>
                        <div className="flex gap-1 mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEditChannel(destination)
                            }}
                          >
                            <Edit className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-error-600"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteChannel(destination.id)
                            }}
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => setShowChannelForm(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Channel
                  </Button>
                </>
              ) : (
                <div className="text-center py-8">
                  <TvMinimal className="w-12 h-12 mx-auto text-slate-400 mb-3" />
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">No channels added</p>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setShowChannelForm(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Channel
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card className="mt-4">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Total Channels</span>
                  <span className="text-lg font-bold">{destinations?.length || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Active Channels</span>
                  <span className="text-lg font-bold text-success-600">
                    {destinations?.filter((c) => c.enabled).length || 0}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Live Streams Panel */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center space-x-2">
                <Radio className="w-5 h-5" />
                <CardTitle>Live Streams</CardTitle>
              </div>
              <Button className="flex items-center space-x-2" onClick={() => setShowCreateStream(true)}>
                <Plus className="w-4 h-4" />
                <span>New Stream</span>
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingStreams ? (
                <LoadingState text="Fetching streams..." />
              ) : streams && streams.length > 0 ? (
                <div className="space-y-4">
                  {streams.map((stream) => (
                    <motion.div
                      key={stream.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="border border-slate-200 dark:border-slate-700 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h3 className="text-lg font-semibold">{stream.name || 'Untitled Stream'}</h3>
                            {renderStatusBadge(stream.status)}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">Playlist</p>
                              <p className="font-medium">{playlistMap.get(stream.playlist_id)?.name || 'Unknown playlist'}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">Status</p>
                              <p className="font-medium">{statusLabelMap[stream.status]}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">Created</p>
                              <p className="font-medium">{formatDistanceToNow(new Date(stream.created_at), { addSuffix: true })}</p>
                            </div>
                          </div>

                          {stream.error_message && (
                            <p className="text-sm text-error-600 dark:text-error-400 flex items-center gap-2 mt-2">
                              <Activity className="w-4 h-4" />
                              {stream.error_message}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center space-x-2 ml-4">
                          <Button size="sm" variant="outline" onClick={() => setViewingLogs(stream.id)}>
                            Logs
                          </Button>
                          {stream.status === 'running' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              isLoading={stopStreamMutation.isPending}
                              onClick={() => stopStreamMutation.mutate(stream.id)}
                            >
                              <Square className="w-4 h-4 mr-2" />
                              Stop
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              isLoading={startStreamMutation.isPending}
                              onClick={() => startStreamMutation.mutate(stream.id)}
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Start
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="danger"
                            isLoading={deleteStreamMutation.isPending}
                            onClick={() => deleteStreamMutation.mutate(stream.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16">
                  <Radio className="w-16 h-16 mx-auto text-slate-400 mb-4" />
                  <p className="text-slate-600 dark:text-slate-400 mb-4">No active streams</p>
                  <p className="text-sm text-slate-500 dark:text-slate-500 mb-6">
                    Create a stream configuration to start broadcasting
                  </p>
                  <Button variant="primary" size="lg" onClick={() => setShowCreateStream(true)}>
                    <Plus className="w-5 h-5 mr-2" />
                    Create Your First Stream
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stream Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-success-600">
                    {streams?.filter((s) => s.status === 'running').length || 0}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Active Streams</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold gradient-text">{streams?.length || 0}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Total Streams</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold gradient-text">
                    {streams?.filter((s) => s.status === 'running').length || 0}/{enabledDestinations.length || 0}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Concurrent Limit</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Channel Form Modal */}
      {showChannelForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-lg animate-scale-in">
            <CardHeader>
              <CardTitle>{editingChannelId ? 'Edit Channel' : 'New Channel'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmitChannel} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Name</label>
                  <Input
                    type="text"
                    required
                    value={channelForm.name}
                    onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })}
                    placeholder="My YouTube Channel"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">RTMPS URL</label>
                  <Input
                    type="text"
                    required
                    value={channelForm.rtmps_url}
                    onChange={(e) => setChannelForm({ ...channelForm, rtmps_url: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Stream Key {editingChannelId && '(leave empty to keep existing)'}
                  </label>
                  <Input
                    type="password"
                    required={!editingChannelId}
                    value={channelForm.stream_key}
                    onChange={(e) => setChannelForm({ ...channelForm, stream_key: e.target.value })}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Your stream key is encrypted and stored securely
                  </p>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={channelForm.enabled}
                    onChange={(e) => setChannelForm({ ...channelForm, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                  />
                  <label className="ml-2 block text-sm text-slate-700 dark:text-slate-300">Enabled</label>
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" onClick={resetChannelForm} variant="secondary">
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    isLoading={createDestinationMutation.isPending || updateDestinationMutation.isPending}
                  >
                    {editingChannelId ? 'Update' : 'Create'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create Stream Modal */}
      {showCreateStream && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-2xl animate-scale-in">
            <CardHeader>
              <CardTitle>Create Stream</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmitStream} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Stream Name</label>
                  <Input
                    placeholder="My awesome stream"
                    value={streamForm.name}
                    onChange={(e) => setStreamForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Playlist</label>
                  <div className="space-y-2">
                    {playlists && playlists.length > 0 ? (
                      playlists.map((playlist) => (
                        <button
                          key={playlist.id}
                          type="button"
                          onClick={() =>
                            setStreamForm((prev) => ({
                              ...prev,
                              playlist_id: playlist.id,
                            }))
                          }
                          className={`w-full text-left p-3 rounded-lg border transition-all ${
                            streamForm.playlist_id === playlist.id
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                              : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-sm text-slate-900 dark:text-white">{playlist.name}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">{playlist.items.length} items</p>
                            </div>
                            <Badge variant={streamForm.playlist_id === playlist.id ? 'success' : 'secondary'}>
                              {streamForm.playlist_id === playlist.id ? 'Selected' : 'Tap to select'}
                            </Badge>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4">
                        <div className="text-left">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No playlists available</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Create a playlist first in the Library section.
                          </p>
                        </div>
                        <ListMusic className="w-6 h-6 text-slate-400" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Destinations</label>
                  <div className="space-y-2">
                    {enabledDestinations.length > 0 ? (
                      enabledDestinations.map((destination) => {
                        const isSelected = streamForm.destination_ids.includes(destination.id)
                        return (
                          <button
                            key={destination.id}
                            type="button"
                            onClick={() => toggleDestination(destination.id)}
                            className={`w-full text-left p-3 rounded-lg border transition-all ${
                              isSelected
                                ? 'border-success-500 bg-success-50 dark:bg-success-900/20'
                                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium text-sm text-slate-900 dark:text-white">{destination.name}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {destination.rtmps_url.split('/').slice(0, 3).join('/')}
                                </p>
                              </div>
                              <Badge variant={isSelected ? 'success' : 'secondary'}>
                                {isSelected ? 'Selected' : 'Tap to select'}
                              </Badge>
                            </div>
                          </button>
                        )
                      })
                    ) : (
                      <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4">
                        <div className="text-left">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No active destinations</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Add a destination in the Channels sidebar.</p>
                        </div>
                        <Plus className="w-6 h-6 text-slate-400" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <Button type="button" onClick={resetStreamForm} variant="secondary">
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!streamForm.playlist_id || streamForm.destination_ids.length === 0}
                    isLoading={createStreamMutation.isPending}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create Stream
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Logs Viewer Modal */}
      {viewingLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-4xl animate-scale-in">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Stream Logs</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setViewingLogs(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="bg-slate-900 text-slate-100 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
                {logsResponse?.logs?.length ? (
                  logsResponse.logs.map((line, index) => <p key={index}>{line}</p>)
                ) : (
                  <p>No logs available</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
