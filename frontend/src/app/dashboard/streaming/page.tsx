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
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

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
  Asset,
  Stream,
  StreamLogsResponse,
  CreateStreamPayload,
  StreamStatusValue,
  StreamStatusResponse,
  StreamQualityResponse,
} from '@/lib/types'
import { useDashboardContext } from '../dashboard-context'

type StreamFormState = {
  name: string
  playlist_id: string | null
  asset_ids: string[]
  destination_ids: string[]
}

type DestinationFormState = {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
}

type QualityViolation = StreamQualityResponse['violations'][number]

type GroupedQualityViolation = {
  assetKey: string
  filename: string | null
  position: number
  issues: Array<{
    violation: QualityViolation
    details: string[]
  }>
}

const statusVariantMap: Record<StreamStatusValue, 'success' | 'info' | 'warning' | 'error'> = {
  running: 'success',
  stopped: 'info',
  starting: 'warning',
  stopping: 'warning',
  error: 'error',
}

export default function StreamingPage() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { user } = useDashboardContext()
  const streamingToasts = useTranslations('streaming.toasts')
  const streamingStatus = useTranslations('streaming.status')
  const tStreaming = useTranslations('streaming.page')

  const violationTranslationKey: Record<string, string> = {
    resolution_exceeded: 'streams.quality.violations.resolution',
    fps_exceeded: 'streams.quality.violations.fps',
    fps_out_of_range: 'streams.quality.violations.fpsRange',
    bitrate_out_of_range: 'streams.quality.violations.bitrateRange',
    bitrate_missing: 'streams.quality.violations.bitrateMissing',
    guideline_missing: 'streams.quality.violations.guidelineMissing',
    missing_metadata: 'streams.quality.violations.missingMetadata',
  }

  const [qualityGate, setQualityGate] = useState<{
    streamName?: string | null
    quality: StreamQualityResponse
  } | null>(null)

  const groupedQualityViolations = useMemo<GroupedQualityViolation[]>(() => {
    if (!qualityGate?.quality?.violations?.length) {
      return []
    }

    const groups = new Map<
      string,
      {
        assetKey: string
        filename: string | null
        position: number
        issues: Map<
          string,
          {
            violation: QualityViolation
            details: string[]
          }
        >
      }
    >()

    qualityGate.quality.violations.forEach((violation, index) => {
      const assetKey =
        violation.asset_id ??
        violation.filename ??
        (typeof violation.position === 'number'
          ? `position-${violation.position}`
          : `index-${index}`)

      if (!groups.has(assetKey)) {
        groups.set(assetKey, {
          assetKey,
          filename: violation.filename ?? null,
          position: typeof violation.position === 'number' ? violation.position : index,
          issues: new Map(),
        })
      }

      const group = groups.get(assetKey)!

      if (typeof violation.position === 'number' && violation.position < group.position) {
        group.position = violation.position
      }
      const issueKey = violation.code ?? `code-${group.issues.size}`
      const existingIssue = group.issues.get(issueKey)

      if (!existingIssue) {
        group.issues.set(issueKey, {
          violation,
          details: violation.message ? [violation.message] : [],
        })
        return
      }

      const existingHasContext =
        existingIssue.violation.allowed != null || existingIssue.violation.current != null
      const newHasContext = violation.allowed != null || violation.current != null

      if (!existingHasContext && newHasContext) {
        existingIssue.violation = { ...violation }
      }

      if (violation.message && !existingIssue.details.includes(violation.message)) {
        existingIssue.details.push(violation.message)
      }
    })

    return Array.from(groups.values())
      .map(({ issues, ...rest }) => ({
        ...rest,
        issues: Array.from(issues.values()),
      }))
      .sort((a, b) => a.position - b.position)
  }, [qualityGate?.quality?.violations])

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
  const [sourceMode, setSourceMode] = useState<'playlist' | 'assets'>('playlist')
  const [streamForm, setStreamForm] = useState<StreamFormState>({
    name: '',
    playlist_id: null,
    asset_ids: [],
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

  const { data: assets, isLoading: isLoadingAssets } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: () => api.assets.list(),
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
    if (sourceMode === 'playlist' && playlists && playlists.length > 0 && !streamForm.playlist_id) {
      setStreamForm((prev) => ({ ...prev, playlist_id: playlists[0].id }))
    }
  }, [sourceMode, playlists, streamForm.playlist_id])

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
      toast.success(streamingToasts('destination.created'))
      resetChannelForm()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
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
      toast.success(streamingToasts('destination.updated'))
      resetChannelForm()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const deleteDestinationMutation = useMutation({
    mutationFn: (destinationId: string) => api.destinations.delete(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations'] })
      toast.success(streamingToasts('destination.deleted'))
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  // Stream Mutations
  const createStreamMutation = useMutation({
    mutationFn: (data: StreamFormState) => {
      const payload: CreateStreamPayload = {
        name: data.name,
        destination_ids: data.destination_ids,
      }

      if (sourceMode === 'playlist') {
        payload.playlist_id = data.playlist_id ?? undefined
      } else {
        payload.asset_ids = data.asset_ids
      }

      return api.streams.create(payload)
    },
    onSuccess: () => {
      toast.success(streamingToasts('stream.created'))
      queryClient.invalidateQueries({ queryKey: ['streams'] })
      resetStreamForm()
    },
    onError: (error: Error) => {
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  type StartStreamVariables = { streamId: string; streamName?: string | null }

  const startStreamMutation = useMutation<StreamStatusResponse, Error & { quality?: StreamQualityResponse }, StartStreamVariables>({
    mutationFn: async ({ streamId }: StartStreamVariables) => {
      const quality = await api.streams.quality(streamId)
      if (!quality.ok) {
        const error = new Error('quality_rejected') as Error & { quality: StreamQualityResponse }
        error.quality = quality
        throw error
      }
      return api.streams.start(streamId)
    },
    onSuccess: (_, variables) => {
      toast.success(streamingToasts('stream.started'))
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
    onError: (error: Error & { quality?: StreamQualityResponse }, variables) => {
      if (error.quality && !error.quality.ok) {
        setQualityGate({ streamName: variables?.streamName, quality: error.quality })
        return
      }
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const stopStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.stop(streamId),
    onSuccess: () => {
      toast.info(streamingToasts('stream.stopped'))
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const deleteStreamMutation = useMutation({
    mutationFn: (streamId: string) => api.streams.delete(streamId),
    onSuccess: (_, streamId) => {
      toast.success(streamingToasts('stream.deleted'))
      if (viewingLogs === streamId) {
        setViewingLogs(null)
      }
      queryClient.invalidateQueries({ queryKey: ['streams'] })
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
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
    setSourceMode('playlist')
    setStreamForm({ name: '', playlist_id: playlists && playlists.length > 0 ? playlists[0].id : null, asset_ids: [], destination_ids: [] })
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

  const handleSourceModeChange = (mode: 'playlist' | 'assets') => {
    setSourceMode(mode)
    setStreamForm((prev) => ({
      ...prev,
      playlist_id:
        mode === 'playlist'
          ? playlists && playlists.length > 0
            ? playlists[0].id
            : null
          : null,
      asset_ids: [],
    }))
  }

  const toggleAssetSelection = (assetId: string) => {
    setStreamForm((prev) => {
      if (prev.asset_ids.includes(assetId)) {
        return { ...prev, asset_ids: prev.asset_ids.filter((id) => id !== assetId) }
      }
      return { ...prev, asset_ids: [...prev.asset_ids, assetId] }
    })
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
    if (confirm(tStreaming('channels.form.confirmDelete'))) {
      deleteDestinationMutation.mutate(destinationId)
    }
  }

  const handleSubmitStream = (event: React.FormEvent) => {
    event.preventDefault()

    if (sourceMode === 'playlist') {
      if (!streamForm.playlist_id) {
        toast.error(streamingToasts('errors.selectPlaylist'))
        return
      }
    } else if (streamForm.asset_ids.length === 0) {
      toast.error(streamingToasts('errors.selectAssets'))
      return
    }

    if (streamForm.destination_ids.length === 0) {
      toast.error(streamingToasts('errors.selectDestination'))
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
    <Badge variant={statusVariantMap[status]}>{streamingStatus(status)}</Badge>
  )

  if (!user) {
    return <LoadingState text={tStreaming('loading')} />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">{tStreaming('header.title')}</h2>
          <p className="text-slate-600 dark:text-slate-400">{tStreaming('header.description')}</p>
        </div>
        <Button onClick={() => setShowCreateStream(true)} className="flex items-center space-x-2">
          <Play className="w-4 h-4" />
          <span>{tStreaming('header.goLive')}</span>
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
                <CardTitle className="text-base">{tStreaming('channels.title')}</CardTitle>
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
                            {destination.enabled
                              ? tStreaming('channels.badge.active')
                              : tStreaming('channels.badge.disabled')}
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
                            {tStreaming('channels.actions.edit')}
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
                            {tStreaming('channels.actions.delete')}
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => setShowChannelForm(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    {tStreaming('channels.add')}
                  </Button>
                </>
              ) : (
                <div className="text-center py-8">
                  <TvMinimal className="w-12 h-12 mx-auto text-slate-400 mb-3" />
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">{tStreaming('channels.empty.title')}</p>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setShowChannelForm(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    {tStreaming('channels.add')}
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
                  <span className="text-sm text-slate-600 dark:text-slate-400">{tStreaming('channels.stats.total')}</span>
                  <span className="text-lg font-bold">{destinations?.length || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">{tStreaming('channels.stats.active')}</span>
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
                <CardTitle>{tStreaming('streams.title')}</CardTitle>
              </div>
              <Button className="flex items-center space-x-2" onClick={() => setShowCreateStream(true)}>
                <Plus className="w-4 h-4" />
                <span>{tStreaming('streams.new')}</span>
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingStreams ? (
                <LoadingState text={tStreaming('fetching')} />
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
                            <h3 className="text-lg font-semibold">{stream.name || tStreaming('streams.untitled')}</h3>
                            {renderStatusBadge(stream.status)}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">{tStreaming('streams.labels.playlist')}</p>
                              <p className="font-medium">{playlistMap.get(stream.playlist_id)?.name || tStreaming('streams.unknownPlaylist')}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">{tStreaming('streams.labels.status')}</p>
                              <p className="font-medium">{streamingStatus(stream.status)}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">{tStreaming('streams.labels.created')}</p>
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
                            {tStreaming('streams.buttons.logs')}
                          </Button>
                          {stream.status === 'running' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              isLoading={stopStreamMutation.isPending}
                              onClick={() => stopStreamMutation.mutate(stream.id)}
                            >
                              <Square className="w-4 h-4 mr-2" />
                              {tStreaming('streams.buttons.stop')}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              isLoading={startStreamMutation.isPending}
                              onClick={() =>
                                startStreamMutation.mutate({
                                  streamId: stream.id,
                                  streamName: stream.name,
                                })
                              }
                            >
                              <Play className="w-4 h-4 mr-2" />
                              {tStreaming('streams.buttons.start')}
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
                  <p className="text-slate-600 dark:text-slate-400 mb-4">{tStreaming('streams.empty.title')}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-500 mb-6">
                    {tStreaming('streams.empty.description')}
                  </p>
                  <Button variant="primary" size="lg" onClick={() => setShowCreateStream(true)}>
                    <Plus className="w-5 h-5 mr-2" />
                    {tStreaming('streams.empty.cta')}
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
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tStreaming('streams.stats.active')}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold gradient-text">{streams?.length || 0}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tStreaming('streams.stats.total')}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold gradient-text">
                    {streams?.filter((s) => s.status === 'running').length || 0}/{enabledDestinations.length || 0}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tStreaming('streams.stats.concurrent')}</p>
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
              <CardTitle>
                {editingChannelId ? tStreaming('channels.form.editTitle') : tStreaming('channels.form.newTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmitChannel} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {tStreaming('channels.form.nameLabel')}
                  </label>
                  <Input
                    type="text"
                    required
                    value={channelForm.name}
                    onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })}
                    placeholder={tStreaming('channels.form.namePlaceholder')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {tStreaming('channels.form.urlLabel')}
                  </label>
                  <Input
                    type="text"
                    required
                    value={channelForm.rtmps_url}
                    onChange={(e) => setChannelForm({ ...channelForm, rtmps_url: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {tStreaming('channels.form.keyLabel')}{' '}
                    {editingChannelId ? tStreaming('channels.form.keepExisting') : ''}
                  </label>
                  <Input
                    type="password"
                    required={!editingChannelId}
                    value={channelForm.stream_key}
                    onChange={(e) => setChannelForm({ ...channelForm, stream_key: e.target.value })}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {tStreaming('channels.form.keyHint')}
                  </p>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={channelForm.enabled}
                    onChange={(e) => setChannelForm({ ...channelForm, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                  />
                  <label className="ml-2 block text-sm text-slate-700 dark:text-slate-300">
                    {tStreaming('channels.form.enabled')}
                  </label>
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" onClick={resetChannelForm} variant="secondary">
                    {tStreaming('channels.form.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    isLoading={createDestinationMutation.isPending || updateDestinationMutation.isPending}
                  >
                    {editingChannelId ? tStreaming('channels.form.update') : tStreaming('channels.form.create')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {qualityGate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-2xl animate-scale-in">
            <CardHeader>
              <CardTitle>{tStreaming('streams.quality.title')}</CardTitle>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {tStreaming('streams.quality.description', {
                  name: qualityGate.streamName || tStreaming('streams.untitled'),
                })}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {tStreaming('streams.quality.limits.resolution')}
                  </p>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">
                    {qualityGate.quality.limits.max_resolution_height
                      ? `${qualityGate.quality.limits.max_resolution_height}p`
                      : tStreaming('streams.quality.limits.unlimited')}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {tStreaming('streams.quality.limits.fps')}
                  </p>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">
                    {qualityGate.quality.limits.max_fps ?? tStreaming('streams.quality.limits.unlimited')}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {tStreaming('streams.quality.limits.bitrate')}
                  </p>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">
                    {qualityGate.quality.limits.max_video_bitrate_mbps
                      ? `${qualityGate.quality.limits.max_video_bitrate_mbps} Mbps`
                      : tStreaming('streams.quality.limits.unlimited')}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-primary-200 dark:border-primary-700/60 bg-primary-50/60 dark:bg-primary-900/30 p-4">
                <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                  {tStreaming('streams.quality.recommended.title')}
                </p>
                {(() => {
                  const recommendation = qualityGate.quality.recommended
                  const resolution =
                    recommendation?.resolution ??
                    `${qualityGate.quality.limits.max_resolution_height ?? 1080}p`
                  const fpsValue =
                    recommendation?.fps ??
                    qualityGate.quality.limits.max_fps ??
                    30
                  const minBitrate = recommendation?.min_bitrate_mbps ?? null
                  const maxBitrate =
                    recommendation?.max_bitrate_mbps ??
                    qualityGate.quality.limits.max_video_bitrate_mbps ??
                    null
                  const targetBitrate = recommendation?.target_bitrate_mbps ?? null
                  const videoCodec = recommendation?.video_codec ?? 'H.264'
                  const audioCodec = recommendation?.audio_codec ?? 'AAC'

                  const formatValue = (value: number | null) => {
                    if (value == null) return null
                    const trimmed = value.toFixed(2).replace(/\.00$/, '')
                    return trimmed
                  }

                  const rangeText = (() => {
                    const min = formatValue(minBitrate)
                    const max = formatValue(maxBitrate)

                    if (min && max) return `${min}–${max} Mbps`
                    if (min) return `≥ ${min} Mbps`
                    if (max) return `≤ ${max} Mbps`
                    return '—'
                  })()

                  const targetClause = targetBitrate != null
                    ? tStreaming('streams.quality.recommended.targetClause', {
                        target: formatValue(targetBitrate) ?? '—',
                      })
                    : ''

                  return (
                    <p className="text-sm text-primary-700 dark:text-primary-300 mt-1">
                      {tStreaming('streams.quality.recommended.description', {
                        resolution,
                        fps: fpsValue.toString(),
                        videoCodec,
                        audioCodec,
                        bitrateRange: rangeText,
                        targetClause,
                      })}
                    </p>
                  )
                })()}
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {tStreaming('streams.quality.detailsHeading')}
                </h4>
                <div className="space-y-3">
                  {groupedQualityViolations.map((group) => (
                    <div
                      key={group.assetKey}
                      className="rounded-lg border border-error-200 dark:border-error-700 bg-error-50/80 dark:bg-error-900/20 p-3"
                    >
                      <p className="text-sm font-semibold text-error-700 dark:text-error-300">
                        {group.filename ??
                          tStreaming('streams.quality.unknownAsset', { index: group.position + 1 })}
                      </p>

                      <div className="mt-2 space-y-2">
                        {group.issues.map(({ violation }, issueIndex) => {
                          const messageKey =
                            violationTranslationKey[violation.code ?? ''] ??
                            'streams.quality.violations.default'

                          return (
                            <div key={`${group.assetKey}-${violation.code ?? issueIndex}`}>
                              <p className="text-sm text-error-700 dark:text-error-300">
                                {tStreaming(messageKey as any, {
                                  current: violation.current ?? '—',
                                  allowed: violation.allowed ?? '—',
                                })}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <Button variant="secondary" onClick={() => setQualityGate(null)}>
                {tStreaming('streams.quality.cta.close')}
              </Button>
              <Button
                onClick={() => {
                  setQualityGate(null)
                  router.push('/dashboard/library')
                }}
              >
                {tStreaming('streams.quality.cta.library')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Create Stream Modal */}
      {showCreateStream && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-2xl animate-scale-in">
            <CardHeader>
              <CardTitle>{tStreaming('streams.form.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmitStream} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {tStreaming('streams.form.nameLabel')}
                  </label>
                  <Input
                    placeholder={tStreaming('streams.form.namePlaceholder')}
                    value={streamForm.name}
                    onChange={(e) => setStreamForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {tStreaming('streams.form.sourceLabel')}
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={sourceMode === 'playlist' ? 'primary' : 'secondary'}
                      onClick={() => handleSourceModeChange('playlist')}
                    >
                      {tStreaming('streams.form.sourceToggle.playlist')}
                    </Button>
                    <Button
                      type="button"
                      variant={sourceMode === 'assets' ? 'primary' : 'secondary'}
                      onClick={() => handleSourceModeChange('assets')}
                    >
                      {tStreaming('streams.form.sourceToggle.assets')}
                    </Button>
                  </div>
                </div>

                {sourceMode === 'playlist' ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {tStreaming('streams.form.playlistLabel')}
                    </label>
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
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {tStreaming('streams.form.playlistItems', { count: playlist.items.length })}
                                </p>
                              </div>
                              <Badge variant={streamForm.playlist_id === playlist.id ? 'success' : 'secondary'}>
                                {streamForm.playlist_id === playlist.id
                                  ? tStreaming('channels.badge.selected')
                                  : tStreaming('channels.badge.tapToSelect')}
                              </Badge>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4">
                          <div className="text-left">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                              {tStreaming('streams.form.playlistNoneTitle')}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {tStreaming('streams.form.playlistNoneDescription')}
                            </p>
                          </div>
                          <ListMusic className="w-6 h-6 text-slate-400" />
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {tStreaming('streams.form.assetsLabel')}
                    </label>
                    {isLoadingAssets ? (
                      <LoadingState text={tStreaming('loading')} />
                    ) : assets && assets.length > 0 ? (
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {assets.map((asset) => {
                          const selectedIndex = streamForm.asset_ids.indexOf(asset.id)
                          const isSelected = selectedIndex !== -1
                          return (
                            <button
                              key={asset.id}
                              type="button"
                              onClick={() => toggleAssetSelection(asset.id)}
                              className={`w-full text-left p-3 rounded-lg border transition-all ${
                                isSelected
                                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="font-medium text-sm text-slate-900 dark:text-white">{asset.filename}</p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {isSelected
                                      ? tStreaming('streams.form.assetSelectedOrder', { index: selectedIndex + 1 })
                                      : tStreaming('streams.form.assetTapToSelect')}
                                  </p>
                                </div>
                                <Badge variant={isSelected ? 'success' : 'secondary'}>
                                  {isSelected
                                    ? tStreaming('channels.badge.selected')
                                    : tStreaming('channels.badge.tapToSelect')}
                                </Badge>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4 text-sm text-slate-600 dark:text-slate-300">
                        {tStreaming('streams.form.assetsNoneDescription')}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {tStreaming('streams.form.destinationsLabel')}
                  </label>
                  <div className="space-y-2">
                    {enabledDestinations.length > 0 ? (
                      enabledDestinations.map((destination) => {
                        const isSelected = streamForm.destination_ids.includes(destination.id)
                        return (
                          <button
                            key={destination.id}
                            type="button"
                            onClick={() => toggleDestination(destination.id)}
                            className={cn(
                              'w-full rounded-lg border p-3 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success-500',
                              isSelected
                                ? 'border-success-500 bg-success-100 text-success-900 dark:border-success-400 dark:bg-success-900/40 dark:text-success-100'
                                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p
                                  className={cn(
                                    'font-medium text-sm',
                                    isSelected
                                      ? 'text-success-900 dark:text-success-100'
                                      : 'text-slate-900 dark:text-white'
                                  )}
                                >
                                  {destination.name}
                                </p>
                                <p
                                  className={cn(
                                    'text-xs',
                                    isSelected
                                      ? 'text-success-800 dark:text-success-300'
                                      : 'text-slate-500 dark:text-slate-400'
                                  )}
                                >
                                  {destination.rtmps_url.split('/').slice(0, 3).join('/')}
                                </p>
                              </div>
                              <Badge variant={isSelected ? 'success' : 'secondary'}>
                                {isSelected
                                  ? tStreaming('channels.badge.selected')
                                  : tStreaming('channels.badge.tapToSelect')}
                              </Badge>
                            </div>
                          </button>
                        )
                      })
                    ) : (
                      <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4">
                        <div className="text-left">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            {tStreaming('streams.form.destinationsNoneTitle')}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {tStreaming('streams.form.destinationsNoneDescription')}
                          </p>
                        </div>
                        <Plus className="w-6 h-6 text-slate-400" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <Button type="button" onClick={resetStreamForm} variant="secondary">
                    {tStreaming('streams.form.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      (sourceMode === 'playlist' && !streamForm.playlist_id) ||
                      (sourceMode === 'assets' && streamForm.asset_ids.length === 0) ||
                      streamForm.destination_ids.length === 0
                    }
                    isLoading={createStreamMutation.isPending}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {tStreaming('streams.form.create')}
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
                <CardTitle>{tStreaming('streams.logs.title')}</CardTitle>
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
                  <p>{tStreaming('streams.logs.empty')}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
