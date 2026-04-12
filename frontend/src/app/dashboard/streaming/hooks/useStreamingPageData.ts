'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { TranslationValues } from 'next-intl'

import { api } from '@/lib/api'
import {
  getProviderHealthIssueCount,
  getProviderStatusKey,
  hasProviderHealthAttention,
} from '@/lib/provider-status'
import type {
  Asset,
  Destination,
  MediaCollection,
  Playlist,
  QuotaUsageResponse,
  YoutubeConnection,
  Stream,
} from '@/lib/types'

type Translator = (key: string, values?: TranslationValues) => string

type UseStreamingPageDataOptions = {
  userId?: string
  quota: QuotaUsageResponse | undefined
  tStreaming: Translator
}

export const useStreamingPageData = ({
  userId,
  quota,
  tStreaming,
}: UseStreamingPageDataOptions) => {
  const { data: destinations, isLoading: isLoadingDestinations } = useQuery<Destination[]>({
    queryKey: ['destinations', userId],
    queryFn: () => api.destinations.list(),
    enabled: !!userId,
  })

  const { data: youtubeConnections } = useQuery<YoutubeConnection[]>({
    queryKey: ['youtube-connections', userId],
    queryFn: () => api.youtube.listConnections(),
    enabled: !!userId,
    staleTime: 30_000,
  })

  const { data: streams, isLoading: isLoadingStreams } = useQuery<Stream[]>({
    queryKey: ['streams', userId],
    queryFn: () => api.streams.list(),
    enabled: !!userId,
    refetchInterval: 3000,
  })

  const { data: playlists } = useQuery<Playlist[]>({
    queryKey: ['playlists', userId],
    queryFn: () => api.playlists.list(),
    enabled: !!userId,
  })

  const { data: assets, isLoading: isLoadingAssets } = useQuery<Asset[]>({
    queryKey: ['assets', userId, 'streaming'],
    queryFn: () => api.assets.list(),
    enabled: !!userId,
  })

  const { data: videoCollections, isLoading: isLoadingVideoCollections } = useQuery<MediaCollection[]>({
    queryKey: ['media-collections', userId, 'video'],
    queryFn: () =>
      api.mediaCollections.list({
        collection_type: 'video_background',
        include_items: true,
      }),
    enabled: !!userId,
  })

  const { data: audioCollections, isLoading: isLoadingAudioCollections } = useQuery<MediaCollection[]>({
    queryKey: ['media-collections', userId, 'audio'],
    queryFn: () =>
      api.mediaCollections.list({
        collection_type: 'audio_playlist',
        include_items: true,
      }),
    enabled: !!userId,
  })

  const playlistMap = useMemo(() => {
    if (!playlists) return new Map<string, Playlist>()
    return new Map(playlists.map((playlist) => [playlist.id, playlist]))
  }, [playlists])

  const videoCollectionMap = useMemo(() => {
    if (!videoCollections) return new Map<string, MediaCollection>()
    return new Map(videoCollections.map((collection) => [collection.id, collection]))
  }, [videoCollections])

  const audioCollectionMap = useMemo(() => {
    if (!audioCollections) return new Map<string, MediaCollection>()
    return new Map(audioCollections.map((collection) => [collection.id, collection]))
  }, [audioCollections])

  const formatLimitValue = (value?: number | null) => (value == null ? '∞' : value.toString())

  const formatProviderStatus = (status?: string | null) =>
    tStreaming(`provider.status.${getProviderStatusKey(status)}`)

  const shouldShowProviderBadge = (destination: Destination) =>
    Boolean(
      destination.provider_connection_id &&
      destination.provider_status &&
      destination.provider_status !== 'unknown',
    )

  const getStreamSourceLabel = (stream: Stream) => {
    if (stream.video_collection_id) {
      return videoCollectionMap.get(stream.video_collection_id)?.name ?? 'Відеоряд'
    }
    if (stream.playlist_id) {
      return playlistMap.get(stream.playlist_id)?.name ?? 'Плейлист'
    }
    if (stream.stream_assets?.length) {
      return `Черга (${stream.stream_assets.length})`
    }
    return 'Джерело не вказано'
  }

  const getStreamSourceTotalSeconds = (stream: Stream) => {
    const collection = stream.video_collection_id
      ? videoCollectionMap.get(stream.video_collection_id)
      : null
    if (collection?.items?.length) {
      const total = collection.items.reduce(
        (sum, item) => sum + (item.asset?.duration_seconds ?? 0),
        0,
      )
      return total > 0 ? total : null
    }

    if (stream.stream_assets?.length && assets?.length) {
      const assetDurations = stream.stream_assets
        .map((link) => assets.find((asset) => asset.id === link.asset_id)?.duration_seconds ?? 0)
        .reduce((sum, duration) => sum + duration, 0)
      return assetDurations > 0 ? assetDurations : null
    }

    return null
  }

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

  return {
    assets,
    audioCollectionMap,
    audioCollections,
    concurrentStreamsLimit: quota?.streams?.limit ?? null,
    destinations,
    destinationsLimit: quota?.destinations?.limit ?? null,
    formatLimitValue,
    formatProviderStatus,
    formatProviderSummary,
    getStreamSourceLabel,
    getStreamSourceTotalSeconds,
    isLoadingAssets,
    isLoadingAudioCollections,
    isLoadingDestinations,
    isLoadingStreams,
    isLoadingVideoCollections,
    planQualityLimits: quota?.quality,
    playlistMap,
    playlists,
    shouldShowProviderBadge,
    streams,
    videoCollectionMap,
    videoCollections,
    youtubeConnections,
  }
}
