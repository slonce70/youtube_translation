'use client'

// IA restructure 2026-04-26: extracted RTMPS Channels out of /streaming
// (where it sat as a 80-LOC card buried mid-page between the stat strip
// and the streams tabs). Channels are a setup-once concern — operators
// configure them rarely but absolutely need them visible on first run.
// Promoting to a dedicated route makes the "set up channel before first
// stream" flow obvious and lets /streaming focus on operating live
// streams instead of also being a setup screen.

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { RadioTower } from 'lucide-react'

import { api } from '@/lib/api'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  getProviderBadgeVariant,
  getProviderHealthIssueCount,
  getProviderStatusKey,
  hasProviderHealthAttention,
} from '@/lib/provider-status'
import type {
  Destination,
  DestinationUpdatePayload,
  YoutubeConnection,
} from '@/lib/types'
import { useDashboardContext } from '../dashboard-context'
import { getDestinationPlatformPresentation } from '../streaming/platform'
import { YOUTUBE_DEFAULT_RTMPS_URL } from '../streaming/types'

const AddChannelModal = dynamic(
  () =>
    import('@/components/streaming/AddChannelModal').then(
      (mod) => mod.AddChannelModal,
    ),
  { ssr: false },
)

type DestinationFormState = {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
  provider_connection_id: string | null
}

const EMPTY_FORM: DestinationFormState = {
  name: '',
  rtmps_url: YOUTUBE_DEFAULT_RTMPS_URL,
  stream_key: '',
  enabled: true,
  provider_connection_id: null,
}

export default function ChannelsPage() {
  const queryClient = useQueryClient()
  const { user } = useDashboardContext()
  const tStreaming = useTranslations('streaming.page')
  const streamingToasts = useTranslations('streaming.toasts')

  const { data: destinations, isLoading: isLoadingDestinations } = useQuery<Destination[]>({
    queryKey: ['destinations', user?.id],
    queryFn: () => api.destinations.list(),
    enabled: !!user,
  })

  const { data: youtubeConnections } = useQuery<YoutubeConnection[]>({
    queryKey: ['youtube-connections', user?.id],
    queryFn: () => api.youtube.listConnections(),
    enabled: !!user,
    staleTime: 30_000,
  })

  const { data: youtubeOAuthConfig } = useQuery({
    queryKey: ['youtube-oauth-config', user?.id],
    queryFn: () => api.youtube.oauthConfig(),
    enabled: !!user,
    staleTime: 60_000,
  })

  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [channelForm, setChannelForm] = useState<DestinationFormState>(EMPTY_FORM)

  const resetForm = () => {
    setChannelForm(EMPTY_FORM)
    setEditingChannelId(null)
    setShowChannelForm(false)
  }

  const createMutation = useMutation({
    mutationFn: (data: DestinationFormState) => api.destinations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations', user?.id] })
      toast.success(streamingToasts('destination.created'))
      resetForm()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DestinationFormState }) => {
      const payload: DestinationUpdatePayload = {
        name: data.name,
        rtmps_url: data.rtmps_url,
        enabled: data.enabled,
      }
      if (data.stream_key.trim()) {
        payload.stream_key = data.stream_key.trim()
      }
      payload.provider_connection_id = data.provider_connection_id
      return api.destinations.update(id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations', user?.id] })
      toast.success(streamingToasts('destination.updated'))
      resetForm()
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const deleteMutation = useMutation({
    mutationFn: (destinationId: string) => api.destinations.delete(destinationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['destinations', user?.id] })
      toast.success(streamingToasts('destination.deleted'))
    },
    onError: (error: Error) =>
      toast.error(streamingToasts('generic.errorWithMessage', { message: error.message })),
  })

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (editingChannelId) {
      updateMutation.mutate({ id: editingChannelId, data: channelForm })
    } else {
      createMutation.mutate(channelForm)
    }
  }

  const handleEdit = (destination: Destination) => {
    setEditingChannelId(destination.id)
    setChannelForm({
      name: destination.name,
      rtmps_url: destination.rtmps_url,
      stream_key: '',
      enabled: destination.enabled,
      provider_connection_id: destination.provider_connection_id ?? null,
    })
    setShowChannelForm(true)
  }

  const handleDelete = (destinationId: string) => {
    if (confirm(tStreaming('channels.form.confirmDelete'))) {
      deleteMutation.mutate(destinationId)
    }
  }

  const handleStartYouTubeConnect = async () => {
    try {
      const redirect_origin = window.location.origin
      const redirect_path = '/dashboard/channels'
      const response = await api.youtube.oauthStart({ redirect_origin, redirect_path })
      window.location.href = response.auth_url
    } catch (error) {
      const message = error instanceof Error ? error.message : tStreaming('provider.oauth.startFailed')
      toast.error(streamingToasts('generic.errorWithMessage', { message }))
    }
  }

  const formatProviderStatus = (status?: string | null) =>
    tStreaming(`provider.status.${getProviderStatusKey(status)}`)

  const shouldShowProviderBadge = (destination: Destination) =>
    Boolean(
      destination.provider_connection_id &&
        destination.provider_status &&
        destination.provider_status !== 'unknown',
    )

  const formatProviderSummary = (destination: Destination) => {
    if (!destination.provider_connection_id) return null
    if (
      !destination.provider_viewers &&
      (!destination.provider_status || destination.provider_status === 'unknown')
    ) {
      return null
    }
    const parts = [formatProviderStatus(destination.provider_status)]
    if (typeof destination.provider_viewers === 'number') {
      parts.push(tStreaming('provider.viewers', { count: destination.provider_viewers }))
    }
    const issueCount = getProviderHealthIssueCount(destination)
    if (issueCount > 0) {
      parts.push(tStreaming('provider.healthIssues', { count: issueCount }))
    } else if (hasProviderHealthAttention(destination)) {
      parts.push(tStreaming('provider.healthDegraded'))
    }
    return parts.join(' · ')
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="page-title">{tStreaming('channelsTitle')}</div>
          <div className="page-sub">{tStreaming('provider.channelsDescription')}</div>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowChannelForm(true)}>{tStreaming('addChannel')}</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tStreaming('channels.title')}</CardTitle>
        </CardHeader>
        <CardContent className="channels-list">
          {isLoadingDestinations ? (
            <LoadingState />
          ) : destinations && destinations.length > 0 ? (
            destinations.map((destination) => {
              const platform = getDestinationPlatformPresentation(destination)
              const PlatformIcon = platform.icon
              return (
                <div
                  key={destination.id}
                  className="channel-row"
                  role="listitem"
                >
                  <div className={platform.className} aria-label={platform.label}>
                    <PlatformIcon className="h-4 w-4" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{destination.name}</div>
                    <div
                      className="truncate"
                      style={{ fontSize: 12, color: 'var(--txt-3)' }}
                    >
                      {destination.rtmps_url} · {tStreaming('destinationKey')}: {destination.stream_key_masked}
                    </div>
                    {formatProviderSummary(destination) ? (
                      <div style={{ fontSize: 12, color: 'var(--txt-2)', marginTop: 4 }}>
                        {formatProviderSummary(destination)}
                      </div>
                    ) : null}
                  </div>
                  <Badge variant={destination.enabled ? 'live' : 'idle'}>
                    {destination.enabled ? tStreaming('destinationActive') : tStreaming('destinationDisabled')}
                  </Badge>
                  {shouldShowProviderBadge(destination) ? (
                    <Badge variant={getProviderBadgeVariant(destination.provider_status)}>
                      {formatProviderStatus(destination.provider_status)}
                    </Badge>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(destination)}>
                    {tStreaming('destinationEdit')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => handleDelete(destination.id)}>
                    {tStreaming('destinationDelete')}
                  </Button>
                </div>
              )
            })
          ) : (
            <div className="empty-state" style={{ padding: '48px 12px' }}>
              <div className="empty-icon" aria-hidden="true"><RadioTower className="h-7 w-7" /></div>
              <div className="empty-title">{tStreaming('channelsEmptyTitle')}</div>
              <div className="empty-sub">{tStreaming('provider.channelsEmpty')}</div>
              <Button variant="outline" onClick={() => setShowChannelForm(true)} style={{ marginTop: 16 }}>
                {tStreaming('channels.add')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {showChannelForm ? (
        <AddChannelModal
          open={showChannelForm}
          editingChannelId={editingChannelId}
          channelForm={channelForm}
          youtubeConnections={youtubeConnections}
          onChange={setChannelForm}
          onSubmit={handleSubmit}
          onCancel={resetForm}
          onStartYouTubeConnect={handleStartYouTubeConnect}
          youtubeOAuthConfigured={youtubeOAuthConfig?.configured ?? true}
          isSaving={createMutation.isPending || updateMutation.isPending}
          t={tStreaming}
        />
      ) : null}
    </div>
  )
}
