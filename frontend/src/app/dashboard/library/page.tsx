'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Uppy from '@uppy/core'
import type { UploadResult } from '@uppy/core'
import Tus from '@uppy/tus'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { 
  AlertCircle, Upload, ListVideo, Plus, CheckCircle, XCircle, Clock, 
  List, PlayCircle, CalendarClock, Edit, Trash2, ChevronDown, ChevronUp, Loader2, X 
} from 'lucide-react'
import { format } from 'date-fns'

import { api } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/utils'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Input } from '@/components/ui/Input'
import type { Asset, Playlist, PlaylistCreatePayload, PlaylistItemInput, PlaylistUpdatePayload } from '@/lib/types'
import { UploadModal } from '@/components/upload/UploadModal'
import { matchBitrateRecommendation } from '@/lib/videoRecommendations'
import { AssetActionsMenu } from '@/components/AssetActionsMenu'
import { useDashboardContext } from '../dashboard-context'

type PlaylistFormState = PlaylistCreatePayload & { description: string }

type AssetDisplayInfo = {
  videoCodec?: string
  videoBitrate?: number
  videoWidth?: number
  videoHeight?: number
  videoFps?: number
  audioCodec?: string
  audioBitrate?: number
  audioSampleRate?: number
  audioChannels?: number
  issues: string[]
  warnings: AssetWarning[]
  recommendationLabel?: string
  recommendationDetails?: string
  bitrateStatus: 'within' | 'outside' | 'unknown'
}

type AssetWarning =
  | {
      kind: 'bitrateRange'
      payload: {
        resolution: string
        fps: number
        min: string
        max: string
        target: string
      }
    }
  | { kind: 'fpsOutOfGuideline' }
  | {
      kind: 'videoCodec'
      payload: { expected: string; found?: string | null }
    }
  | {
      kind: 'audioCodec'
      payload: { expected: string; found?: string | null }
    }
  | {
      kind: 'pixelFormat'
      payload: { expected: string; found?: string | null }
    }
  | {
      kind: 'gopTooLarge'
      payload: { found: string; limit: string }
    }
  | { kind: 'noVideoStream' }
  | { kind: 'noAudioStream' }
  | {
      kind: 'requiresTranscode'
      payload?: { video?: string; audio?: string; pixel?: string }
    }
  | { kind: 'missingMetadata' }
  | { kind: 'custom'; message: string }

const formatBitrateDisplay = (bps?: number): string => {
  if (!bps || !Number.isFinite(bps)) return '—'
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps.toFixed(0)} bit/s`
}

const formatFpsDisplay = (fps?: number): string => {
  if (!fps || !Number.isFinite(fps)) return '—'
  return fps % 1 === 0 ? `${fps.toFixed(0)} FPS` : `${fps.toFixed(2)} FPS`
}

const formatSampleRateDisplay = (hz?: number): string => {
  if (!hz || !Number.isFinite(hz)) return '—'
  if (hz >= 1000) return `${(hz / 1000).toFixed(0)} kHz`
  return `${hz.toFixed(0)} Hz`
}

const deriveAssetDisplayInfo = (asset: Asset): AssetDisplayInfo => {
  const meta = (asset.meta ?? {}) as Record<string, any>
  const video = (meta?.video ?? {}) as Record<string, any>
  const audio = (meta?.audio ?? {}) as Record<string, any>
  const backendWarnings = Array.isArray(meta?.warnings) ? (meta.warnings as string[]) : []
  const rawValidationErrors = Array.isArray(asset.validation_errors)
    ? [...(asset.validation_errors as string[])]
    : []
  const backendRecommendation = meta?.recommendation as
    | {
        label?: string
        fps?: number
        min_bitrate_mbps?: number
        max_bitrate_mbps?: number
        target_bitrate_mbps?: number
        bitrate_status?: string
        normalized_fps?: number | null
        fps_out_of_guideline?: boolean
      }
    | undefined

  const safeNumber = (value: any): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
  }

  let recommendation = matchBitrateRecommendation(
    safeNumber(video.height),
    safeNumber(video.fps)
  )

  if (backendRecommendation?.label && backendRecommendation.min_bitrate_mbps) {
    recommendation = {
      rule: {
        resolutionLabel: backendRecommendation.label,
        minHeight: 0,
        maxHeight: Number.MAX_SAFE_INTEGER,
        fps: (backendRecommendation.normalized_fps as 30 | 60 | undefined) ?? 30,
        minBitrateMbps: backendRecommendation.min_bitrate_mbps,
        maxBitrateMbps:
          backendRecommendation.max_bitrate_mbps ?? backendRecommendation.min_bitrate_mbps,
        targetBitrateMbps:
          backendRecommendation.target_bitrate_mbps ?? backendRecommendation.min_bitrate_mbps,
      },
      normalizedFps: (backendRecommendation.normalized_fps as 30 | 60 | null) ?? null,
      fpsOutOfGuideline: Boolean(backendRecommendation.fps_out_of_guideline),
    }
  }

  const warnings: AssetWarning[] = []
  const STREAM_VIDEO_EXPECTED = 'H.264'
  const STREAM_AUDIO_EXPECTED = 'AAC'
  const STREAM_PIXEL_EXPECTED = 'yuv420p'

  const videoBitrate = safeNumber(video.bitrate)
  const videoFps = safeNumber(video.fps)
  const videoWidth = safeNumber(video.width)
  const videoHeight = safeNumber(video.height)
  const audioBitrate = safeNumber(audio.bitrate)
  const audioSampleRate = safeNumber(audio.sample_rate)
  const audioChannels = safeNumber(audio.channels)

  const ensureRequiresTranscode = () => {
    if (!warnings.some((warning) => warning.kind === 'requiresTranscode')) {
      warnings.push({
        kind: 'requiresTranscode',
        payload: {
          video: STREAM_VIDEO_EXPECTED,
          audio: STREAM_AUDIO_EXPECTED,
          pixel: STREAM_PIXEL_EXPECTED,
        },
      })
    }
  }

  const pushBitrateWarning = (): boolean => {
    const rule = recommendation.rule
    if (!rule) return false
    if (warnings.some((warning) => warning.kind === 'bitrateRange')) return true

    const resolutionLabel = rule.resolutionLabel ?? (videoHeight ? `${videoHeight}p` : '?p')
    const fpsValue = rule.fps ?? (videoFps ? Math.round(videoFps) : 0)

    warnings.push({
      kind: 'bitrateRange',
      payload: {
        resolution: resolutionLabel,
        fps: fpsValue,
        min: rule.minBitrateMbps.toFixed(0),
        max: rule.maxBitrateMbps.toFixed(0),
        target: rule.targetBitrateMbps.toFixed(0),
      },
    })
    return true
  }

  const pushFpsWarning = (): void => {
    if (!warnings.some((warning) => warning.kind === 'fpsOutOfGuideline')) {
      warnings.push({ kind: 'fpsOutOfGuideline' })
    }
  }

  const pushVideoCodecWarning = (found?: string | null, expected: string = STREAM_VIDEO_EXPECTED) => {
    warnings.push({
      kind: 'videoCodec',
      payload: {
        expected,
        found: found ? found.toUpperCase() : found,
      },
    })
    ensureRequiresTranscode()
  }

  const pushAudioCodecWarning = (found?: string | null, expected: string = STREAM_AUDIO_EXPECTED) => {
    warnings.push({
      kind: 'audioCodec',
      payload: {
        expected,
        found: found ? found.toUpperCase() : found,
      },
    })
    ensureRequiresTranscode()
  }

  const pushPixelFormatWarning = (found?: string | null, expected: string = STREAM_PIXEL_EXPECTED) => {
    warnings.push({
      kind: 'pixelFormat',
      payload: {
        expected,
        found,
      },
    })
    ensureRequiresTranscode()
  }

  const pushMissingMetadataWarning = () => {
    if (!warnings.some((warning) => warning.kind === 'missingMetadata')) {
      warnings.push({ kind: 'missingMetadata' })
    }
    ensureRequiresTranscode()
  }

  const pushNoVideoStreamWarning = () => {
    if (!warnings.some((warning) => warning.kind === 'noVideoStream')) {
      warnings.push({ kind: 'noVideoStream' })
    }
    ensureRequiresTranscode()
  }

  const pushNoAudioStreamWarning = () => {
    if (!warnings.some((warning) => warning.kind === 'noAudioStream')) {
      warnings.push({ kind: 'noAudioStream' })
    }
    ensureRequiresTranscode()
  }

  const pushGopWarning = (found: string, limit: string) => {
    warnings.push({ kind: 'gopTooLarge', payload: { found, limit } })
    ensureRequiresTranscode()
  }

  for (const warning of backendWarnings) {
    const normalized = warning.toLowerCase()
    if (normalized.startsWith('video bitrate is outside')) {
      if (pushBitrateWarning()) {
        continue
      }
    }

    if (normalized.startsWith('frame rate differs')) {
      pushFpsWarning()
      continue
    }

    if (normalized.includes('video codec must')) {
      const expectedMatch = warning.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = warning.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushVideoCodecWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_VIDEO_EXPECTED).toUpperCase())
      continue
    }

    if (normalized.includes('audio codec must')) {
      const expectedMatch = warning.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = warning.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushAudioCodecWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_AUDIO_EXPECTED).toUpperCase())
      continue
    }

    if (normalized.includes('pixel format must')) {
      const expectedMatch = warning.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = warning.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushPixelFormatWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_PIXEL_EXPECTED).toLowerCase())
      continue
    }

    if (normalized.includes('gop size')) {
      const sizeMatch = warning.match(/gop size[^0-9]*(\d+)/i)
      const limitMatch = warning.match(/(?:max|limit)\s*(\d+)/i)
      if (sizeMatch) {
        pushGopWarning(sizeMatch[1], limitMatch?.[1] ?? '')
        continue
      }
    }

    if (normalized.includes('no video stream')) {
      pushNoVideoStreamWarning()
      continue
    }

    if (normalized.includes('no audio stream')) {
      pushNoAudioStreamWarning()
      continue
    }

    if (normalized.includes('requires transcod')) {
      ensureRequiresTranscode()
      continue
    }

    if (normalized.includes('metadata is required') || normalized.includes('metadata is incomplete')) {
      pushMissingMetadataWarning()
      continue
    }

    warnings.push({ kind: 'custom', message: warning })
  }

  const unresolvedValidationIssues: string[] = []

  for (const issue of rawValidationErrors) {
    const normalized = issue.toLowerCase()
    let handled = false

    if (normalized.includes('video codec must')) {
      const expectedMatch = issue.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = issue.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushVideoCodecWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_VIDEO_EXPECTED).toUpperCase())
      handled = true
    } else if (normalized.includes('audio codec must')) {
      const expectedMatch = issue.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = issue.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushAudioCodecWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_AUDIO_EXPECTED).toUpperCase())
      handled = true
    } else if (normalized.includes('pixel format must')) {
      const expectedMatch = issue.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = issue.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushPixelFormatWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_PIXEL_EXPECTED).toLowerCase())
      handled = true
    } else if (normalized.includes('gop size')) {
      const sizeMatch = issue.match(/gop size[^0-9]*(\d+)/i)
      const limitMatch = issue.match(/(?:max|limit)\s*(\d+)/i)
      if (sizeMatch) {
        pushGopWarning(sizeMatch[1], limitMatch?.[1] ?? '')
        handled = true
      }
    } else if (normalized.includes('no video stream')) {
      pushNoVideoStreamWarning()
      handled = true
    } else if (normalized.includes('no audio stream')) {
      pushNoAudioStreamWarning()
      handled = true
    } else if (normalized.includes('requires transcod')) {
      ensureRequiresTranscode()
      handled = true
    } else if (normalized.includes('metadata is required') || normalized.includes('metadata is incomplete')) {
      pushMissingMetadataWarning()
      handled = true
    }

    if (!handled) {
      unresolvedValidationIssues.push(issue)
    }
  }

  let bitrateStatus: AssetDisplayInfo['bitrateStatus'] =
    backendRecommendation?.bitrate_status === 'within'
      ? 'within'
      : backendRecommendation?.bitrate_status === 'outside'
      ? 'outside'
      : 'unknown'

  if (recommendation.rule && videoBitrate && bitrateStatus === 'unknown') {
    const bitrateMbps = videoBitrate / 1_000_000
    if (
      bitrateMbps >= recommendation.rule.minBitrateMbps &&
      bitrateMbps <= recommendation.rule.maxBitrateMbps
    ) {
      bitrateStatus = 'within'
    } else {
      bitrateStatus = 'outside'
      pushBitrateWarning()
    }
  }

  if (
    backendRecommendation?.fps_out_of_guideline ?? recommendation.fpsOutOfGuideline
  ) {
    pushFpsWarning()
  }

  const hasVideoMetadata = video && Object.keys(video).length > 0
  const hasAudioMetadata = audio && Object.keys(audio).length > 0

  if (!hasVideoMetadata || !hasAudioMetadata) {
    pushMissingMetadataWarning()
  }

  if (asset.compatible_for_copy === false) {
    ensureRequiresTranscode()
  }

  return {
    videoCodec: video.codec,
    videoBitrate,
    videoWidth,
    videoHeight,
    videoFps,
    audioCodec: audio.codec,
    audioBitrate,
    audioSampleRate,
    audioChannels,
    issues: unresolvedValidationIssues,
    warnings,
    recommendationLabel: recommendation.rule
      ? `${recommendation.rule.resolutionLabel}, ${recommendation.rule.fps} FPS`
      : undefined,
    recommendationDetails: recommendation.rule
      ? `${recommendation.rule.minBitrateMbps.toFixed(0)}–${recommendation.rule.maxBitrateMbps.toFixed(0)} Mbps · target ${recommendation.rule.targetBitrateMbps.toFixed(0)} Mbps`
      : undefined,
    bitrateStatus,
  }
}

export default function LibraryPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useDashboardContext()
  const libraryToasts = useTranslations('library.toasts')
  const tLibrary = useTranslations('library.page')
  const tAssetWarnings = useTranslations('library.page.assets.warnings')
  const actionLabels = useTranslations('common.actions')

  const formatWarningMessage = (warning: AssetWarning): string => {
    switch (warning.kind) {
      case 'bitrateRange':
        return tAssetWarnings('bitrateRange', {
          resolution: warning.payload.resolution,
          fps: warning.payload.fps,
          min: warning.payload.min,
          max: warning.payload.max,
          target: warning.payload.target,
        })
      case 'fpsOutOfGuideline':
        return tAssetWarnings('fpsOutOfGuideline')
      case 'videoCodec':
        return tAssetWarnings('videoCodec', {
          expected: warning.payload.expected,
          found: warning.payload.found ?? tAssetWarnings('unknownValue'),
        })
      case 'audioCodec':
        return tAssetWarnings('audioCodec', {
          expected: warning.payload.expected,
          found: warning.payload.found ?? tAssetWarnings('unknownValue'),
        })
      case 'pixelFormat':
        return tAssetWarnings('pixelFormat', {
          expected: warning.payload.expected,
          found: warning.payload.found ?? tAssetWarnings('unknownValue'),
        })
      case 'gopTooLarge':
        return tAssetWarnings('gopTooLarge', {
          found: warning.payload.found,
          limit: warning.payload.limit,
        })
      case 'noVideoStream':
        return tAssetWarnings('noVideoStream')
      case 'noAudioStream':
        return tAssetWarnings('noAudioStream')
      case 'requiresTranscode':
        return tAssetWarnings('requiresTranscode', {
          video: warning.payload?.video ?? 'H.264',
          audio: warning.payload?.audio ?? 'AAC',
          pixel: warning.payload?.pixel ?? 'yuv420p',
        })
      case 'missingMetadata':
        return tAssetWarnings('missingMetadata')
      default:
        return warning.message
    }
  }

  // Tab management with URL sync
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'assets')

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && (tab === 'assets' || tab === 'playlists')) {
      setActiveTab(tab)
    }
  }, [searchParams])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    router.push(`/dashboard/library?tab=${tab}`, { scroll: false })
  }

  // Assets state
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isProcessingUpload, setIsProcessingUpload] = useState(false)
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set())
  const [assetBeingRenamed, setAssetBeingRenamed] = useState<Asset | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [checkingAssetId, setCheckingAssetId] = useState<string | null>(null)
  const [downloadAssetId, setDownloadAssetId] = useState<string | null>(null)
  const [checkModalAsset, setCheckModalAsset] = useState<Asset | null>(null)
  const [checkModalInfo, setCheckModalInfo] = useState<AssetDisplayInfo | null>(null)
  const [isCheckModalLoading, setIsCheckModalLoading] = useState(false)

  // Playlists state
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false)
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null)
  const [playlistForm, setPlaylistForm] = useState<PlaylistFormState>({
    name: '',
    description: '',
    loop: true,
    items: [],
  })

  // Uppy configuration
  const tusEndpoint = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_TUSD_URL || 'http://localhost:1080'
    return `${base.replace(/\/$/, '')}/files/`
  }, [])

  const [uppy] = useState(() =>
    new Uppy<Record<string, string>, Record<string, any>>({
      autoProceed: false,
      restrictions: {
        allowedFileTypes: ['video/*'],
        maxFileSize: 10 * 1024 * 1024 * 1024, // 10 GB
      },
    })
  )

  useEffect(() => {
    const existingPlugin = uppy.getPlugin('Tus')
    if (existingPlugin) {
      uppy.removePlugin(existingPlugin)
    }

    uppy.use(Tus, {
      endpoint: tusEndpoint,
      chunkSize: 5 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
    })

    const handleComplete = async (result: UploadResult<Record<string, string>, Record<string, any>>) => {
      if (!result.successful || !result.successful.length) {
        return
      }

      setIsProcessingUpload(true)
      const toastId = toast.loading(libraryToasts('upload.finalizing'))

      try {
        await queryClient.invalidateQueries({ queryKey: ['assets'] })
        await queryClient.refetchQueries({ queryKey: ['assets'], type: 'active' })

        toast.success(libraryToasts('upload.processed'), { id: toastId })
        setIsUploadOpen(false)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        toast.error(libraryToasts('upload.refreshFailed', { message }), { id: toastId })
      } finally {
        uppy.cancelAll()
        const fileIds = uppy.getFiles().map((file) => file.id)
        if (fileIds.length) {
          uppy.removeFiles(fileIds)
        }
        setIsProcessingUpload(false)
      }
    }

    const handleError = (error: Error) => {
      toast.error(libraryToasts('upload.failed', { message: error.message }))
    }

    uppy.on('complete', handleComplete)
    uppy.on('error', handleError)

    return () => {
      uppy.off('complete', handleComplete)
      uppy.off('error', handleError)
      const plugin = uppy.getPlugin('Tus')
      if (plugin) {
        uppy.removePlugin(plugin)
      }
    }
  }, [libraryToasts, queryClient, tusEndpoint, uppy])

  useEffect(() => {
    if (user?.id) {
      uppy.setMeta({
        user_id: user.id,
      })
    }
  }, [uppy, user?.id])

  // API Queries
  const { data: assets, isLoading: isLoadingAssets } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: () => api.assets.list(),
    enabled: !!user,
  })

  const { data: playlists, isLoading: isLoadingPlaylists } = useQuery<Playlist[]>({
    queryKey: ['playlists'],
    queryFn: () => api.playlists.list(),
    enabled: !!user,
  })

  // Mutations
  const deleteAssetMutation = useMutation({
    mutationFn: (assetId: string) => api.assets.delete(assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      toast.success(libraryToasts('asset.deleted'))
    },
    onError: (error: Error) => {
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const revalidateAssetMutation = useMutation({
    mutationFn: (assetId: string) => api.assets.revalidate(assetId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (error: Error) => {
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const updateAssetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { filename?: string } }) =>
      api.assets.update(id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assets'] })
      toast.success(libraryToasts('asset.updated'))
    },
    onError: (error: Error) => {
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const downloadLinkMutation = useMutation({
    mutationFn: (assetId: string) => api.assets.createDownloadLink(assetId),
    onError: (error: Error) => {
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const createPlaylistMutation = useMutation({
    mutationFn: (data: PlaylistCreatePayload) => api.playlists.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      toast.success(libraryToasts('playlist.created'))
      resetPlaylistForm()
    },
    onError: (error: Error) =>
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message })),
  })

  const updatePlaylistMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PlaylistFormState }) => {
      const payload: PlaylistUpdatePayload = {
        name: data.name,
        description: data.description,
        loop: data.loop,
        items: data.items,
      }
      return api.playlists.update(id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      toast.success(libraryToasts('playlist.updated'))
      resetPlaylistForm()
    },
    onError: (error: Error) =>
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message })),
  })

  const deletePlaylistMutation = useMutation({
    mutationFn: (playlistId: string) => api.playlists.delete(playlistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      toast.success(libraryToasts('playlist.deleted'))
    },
    onError: (error: Error) =>
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message })),
  })

  // Handlers
  const handleDeleteAsset = (assetId: string) => {
    if (confirm('Are you sure you want to delete this asset?')) {
      deleteAssetMutation.mutate(assetId)
    }
  }

  const toggleAssetDetails = (assetId: string) => {
    setExpandedAssets((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) {
        next.delete(assetId)
      } else {
        next.add(assetId)
      }
      return next
    })
  }

  const handleRenameAsset = (asset: Asset) => {
    setAssetBeingRenamed(asset)
    setRenameValue(asset.filename)
  }

  const closeRenameModal = () => {
    setAssetBeingRenamed(null)
    setRenameValue('')
  }

  const submitRename = async () => {
    if (!assetBeingRenamed) return
    const trimmed = renameValue.trim()
    if (!trimmed) {
      toast.error(libraryToasts('asset.renameEmpty'))
      return
    }
    try {
      await updateAssetMutation.mutateAsync({ id: assetBeingRenamed.id, data: { filename: trimmed } })
      closeRenameModal()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update asset'
      toast.error(libraryToasts('generic.errorWithMessage', { message }))
    }
  }

  const handleCheckAsset = async (asset: Asset) => {
    setCheckingAssetId(asset.id)
    setCheckModalAsset(asset)
    setCheckModalInfo(null)
    setIsCheckModalLoading(true)
    try {
      const updated = await revalidateAssetMutation.mutateAsync(asset.id)
      if (updated) {
        setCheckModalAsset(updated)
        setCheckModalInfo(deriveAssetDisplayInfo(updated))
        toast.success(libraryToasts('asset.validationRefreshed'))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate asset'
      toast.error(libraryToasts('generic.errorWithMessage', { message }))
      setCheckModalAsset(null)
      setCheckModalInfo(null)
    } finally {
      setCheckingAssetId(null)
      setIsCheckModalLoading(false)
    }
  }

  const closeCheckModal = () => {
    setCheckModalAsset(null)
    setCheckModalInfo(null)
    setIsCheckModalLoading(false)
  }

  const handleDownloadAsset = async (asset: Asset) => {
    setDownloadAssetId(asset.id)
    try {
      const link = await downloadLinkMutation.mutateAsync(asset.id)
      window.open(link.download_url, '_blank', 'noopener,noreferrer')
      toast.info(libraryToasts('asset.download', { name: asset.filename }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate download link'
      toast.error(libraryToasts('generic.errorWithMessage', { message }))
    } finally {
      setDownloadAssetId(null)
    }
  }

  const handleNotImplemented = (feature: string) => {
    toast.info(libraryToasts('generic.comingSoon', { feature }))
  }

  const resetPlaylistForm = () => {
    setPlaylistForm({ name: '', description: '', loop: true, items: [] })
    setShowCreatePlaylist(false)
    setEditingPlaylistId(null)
  }

  const handleSubmitPlaylist = (event: React.FormEvent) => {
    event.preventDefault()
    if (editingPlaylistId) {
      updatePlaylistMutation.mutate({ id: editingPlaylistId, data: playlistForm })
    } else {
      createPlaylistMutation.mutate(playlistForm)
    }
  }

  const handleEditPlaylist = (playlist: Playlist) => {
    setEditingPlaylistId(playlist.id)
    setPlaylistForm({
      name: playlist.name,
      description: playlist.description || '',
      loop: playlist.loop,
      items: (playlist.items || []).map((item, index): PlaylistItemInput => ({
        asset_id: item.asset_id,
        position: index,
      })),
    })
    setShowCreatePlaylist(true)
  }

  const handleDeletePlaylist = (playlistId: string) => {
    if (confirm('Are you sure you want to delete this playlist?')) {
      deletePlaylistMutation.mutate(playlistId)
    }
  }

  const addAssetToPlaylist = (assetId: string) => {
    setPlaylistForm((prev) => ({
      ...prev,
      items: [...prev.items, { asset_id: assetId, position: prev.items.length }],
    }))
  }

  const removeAssetFromPlaylist = (index: number) => {
    setPlaylistForm((prev) => ({
      ...prev,
      items: prev.items
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({ ...item, position: itemIndex })),
    }))
  }

  const assetsMap = useMemo(() => {
    if (!assets) return new Map<string, Asset>()
    return new Map(assets.map((asset) => [asset.id, asset]))
  }, [assets])

  const availableAssets = useMemo<Asset[]>(() => {
    if (!assets) return [] as Asset[]
    return assets
      .filter((asset) => asset.compatible_for_copy)
      .filter((asset) => !playlistForm.items.some((item) => item.asset_id === asset.id))
  }, [assets, playlistForm.items])

  // Calculate stats
  const totalAssets = assets?.length || 0
  const totalPlaylists = playlists?.length || 0
  const totalStorage = assets?.reduce((sum, asset) => sum + asset.size_bytes, 0) || 0

  if (!user) {
    return <LoadingState text={tLibrary('loading')} />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">{tLibrary('header.title')}</h2>
          <p className="text-slate-600 dark:text-slate-400">
            {tLibrary('header.description')}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="assets" className="flex items-center space-x-2">
            <Upload className="w-4 h-4" />
            <span>{tLibrary('tabs.assets', { count: totalAssets })}</span>
          </TabsTrigger>
          <TabsTrigger value="playlists" className="flex items-center space-x-2">
            <ListVideo className="w-4 h-4" />
            <span>{tLibrary('tabs.playlists', { count: totalPlaylists })}</span>
          </TabsTrigger>
        </TabsList>

        {/* Assets Tab */}
        <TabsContent value="assets" className="mt-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">{tLibrary('assets.title')}</h3>
              <Button onClick={() => setIsUploadOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                {tLibrary('assets.upload')}
              </Button>
            </div>

            {isLoadingAssets ? (
              <LoadingState />
            ) : assets && assets.length > 0 ? (
              <div className="grid gap-4">
                {assets.map((asset) => {
                  const info = deriveAssetDisplayInfo(asset)
                  const uploadedAt = format(new Date(asset.created_at), 'MMM d, yyyy • HH:mm')
                  const isExpanded = expandedAssets.has(asset.id)

                  return (
                    <Card key={asset.id} className="animate-slide-up">
                      <CardContent className="py-6 space-y-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="flex flex-1 items-start gap-3 min-w-0">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/30 dark:to-accent-900/20">
                              <Upload className="w-5 h-5 text-primary-500" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-3">
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                                  {asset.filename}
                                </h3>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
                                <div className="flex items-center gap-2">
                                  <Clock className="w-4 h-4" />
                                  <span>{formatBytes(asset.size_bytes)}</span>
                                  {asset.duration_seconds ? (
                                    <>
                                      <span>•</span>
                                      <span>{formatDuration(asset.duration_seconds)}</span>
                                    </>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2">
                                  <CalendarClock className="w-4 h-4" />
                                  <span>{uploadedAt}</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={asset.compatible_for_copy ? 'success' : 'error'}>
                                  {asset.compatible_for_copy ? (
                                    <>
                                      <CheckCircle className="w-3 h-3 mr-1" />
                                      {tLibrary('assets.badges.ready')}
                                    </>
                                  ) : (
                                    <>
                                      <XCircle className="w-3 h-3 mr-1" />
                                      {tLibrary('assets.badges.needsEncoding')}
                                    </>
                                  )}
                                </Badge>
                                {info.bitrateStatus === 'within' ? (
                                  <Badge variant="success">{tLibrary('assets.badges.bitrateOk')}</Badge>
                                ) : info.bitrateStatus === 'outside' ? (
                                  <Badge variant="warning">{tLibrary('assets.badges.bitrateCheck')}</Badge>
                                ) : null}
                              </div>
                              {!asset.compatible_for_copy && (
                                <div className="text-sm text-error-600 dark:text-error-400">
                                  {tLibrary('assets.messages.incompatibleSummary')}
                                  {info.issues.length > 0 && (
                                    <span className="block text-xs text-error-500/90 dark:text-error-300">
                                      {info.issues[0]}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <AssetActionsMenu
                            onEdit={() => handleRenameAsset(asset)}
                            onDelete={() => handleDeleteAsset(asset.id)}
                            onCheck={() => handleCheckAsset(asset)}
                            onPlaylists={() => handleNotImplemented(tLibrary('assets.menu.items.playlists'))}
                            onOptimize={() => handleNotImplemented(tLibrary('assets.menu.items.optimize'))}
                            onMove={() => handleNotImplemented(tLibrary('assets.menu.items.move'))}
                            onDownload={() => handleDownloadAsset(asset)}
                            isDeleting={
                              deleteAssetMutation.isPending && deleteAssetMutation.variables === asset.id
                            }
                            isChecking={checkingAssetId === asset.id}
                            isGeneratingDownload={
                              downloadAssetId === asset.id && downloadLinkMutation.isPending
                            }
                          />
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-700">
                          <button
                            type="button"
                            onClick={() => toggleAssetDetails(asset.id)}
                            className="flex items-center gap-2 text-sm font-medium text-primary-600 transition-colors hover:text-primary-500 dark:text-primary-400"
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {isExpanded
                              ? tLibrary('assets.details.hide')
                              : tLibrary('assets.details.show')}
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                            <div className="grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  {tLibrary('assets.metadata.video')}
                                </span>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <Badge variant="secondary">{info.videoCodec?.toUpperCase() ?? '—'}</Badge>
                                  <span>{formatBitrateDisplay(info.videoBitrate)}</span>
                                  <span>·</span>
                                  <span>
                                    {info.videoWidth && info.videoHeight
                                      ? `${info.videoWidth}×${info.videoHeight}`
                                      : '—'}
                                  </span>
                                  <span>·</span>
                                  <span>{formatFpsDisplay(info.videoFps)}</span>
                                </div>
                              </div>

                              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  {tLibrary('assets.metadata.audio')}
                                </span>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <Badge variant="secondary">{info.audioCodec?.toUpperCase() ?? '—'}</Badge>
                                  <span>{formatBitrateDisplay(info.audioBitrate)}</span>
                                  <span>·</span>
                                  <span>{formatSampleRateDisplay(info.audioSampleRate)}</span>
                                  {info.audioChannels ? (
                                    <>
                                      <span>·</span>
                                      <span>{tLibrary('assets.metadata.channels', { count: info.audioChannels })}</span>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            {info.recommendationLabel ? (
                              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <CheckCircle className="w-4 h-4 text-primary-500" />
                                <span>
                                  {tLibrary('assets.recommendations', {
                                    label: info.recommendationLabel,
                                    details: info.recommendationDetails,
                                  })}
                                </span>
                              </div>
                            ) : null}

                            {(info.issues.length > 0 || info.warnings.length > 0) && (
                              <div className="space-y-2">
                                {info.issues.map((issue, index) => (
                                  <div
                                    key={`asset-issue-${index}`}
                                    className="flex items-start text-sm text-error-600 dark:text-error-400"
                                  >
                                    <XCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                                    <span>{issue}</span>
                                  </div>
                                ))}
                                {info.warnings.map((warning, index) => (
                                  <div
                                    key={`asset-warning-${index}`}
                                    className="flex items-start text-sm text-amber-600 dark:text-amber-400"
                                  >
                                    <AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                                    <span>{formatWarningMessage(warning)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            ) : (
              <Card className="text-center py-16">
                <div className="flex flex-col items-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/20 dark:to-accent-900/20 flex items-center justify-center">
                    <Upload className="w-8 h-8 text-primary-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                      {tLibrary('assets.empty.title')}
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 mb-4">
                      {tLibrary('assets.empty.description')}
                    </p>
                  </div>
                  <Button onClick={() => setIsUploadOpen(true)} className="gap-2">
                    <Upload className="w-4 h-4" />
                    {tLibrary('assets.empty.cta')}
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Playlists Tab */}
        <TabsContent value="playlists" className="mt-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">{tLibrary('playlists.title')}</h3>
              <Button onClick={() => setShowCreatePlaylist(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                {tLibrary('playlists.actions.create')}
              </Button>
            </div>

            {showCreatePlaylist && (
              <Card className="animate-scale-in">
                <CardHeader>
                  <CardTitle>
                    {editingPlaylistId
                      ? tLibrary('playlists.actions.editTitle')
                      : tLibrary('playlists.actions.newTitle')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmitPlaylist} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {tLibrary('playlists.fields.name')}
                      </label>
                      <Input
                        type="text"
                        required
                        value={playlistForm.name}
                        onChange={(e) => setPlaylistForm({ ...playlistForm, name: e.target.value })}
                        placeholder={tLibrary('playlists.fields.namePlaceholder')}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {tLibrary('playlists.fields.description')}
                      </label>
                      <textarea
                        value={playlistForm.description}
                        onChange={(e) => setPlaylistForm({ ...playlistForm, description: e.target.value })}
                        rows={3}
                        placeholder={tLibrary('playlists.fields.descriptionPlaceholder')}
                        className="block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-colors"
                      />
                    </div>
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={playlistForm.loop}
                        onChange={(e) => setPlaylistForm({ ...playlistForm, loop: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                      />
                      <label className="ml-2 block text-sm text-slate-700 dark:text-slate-300">
                        {tLibrary('playlists.fields.loop')}
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {tLibrary('playlists.fields.assets')}
                      </label>
                      {playlistForm.items.length > 0 ? (
                        <ul className="space-y-2 mb-4">
                          {playlistForm.items.map((item, index) => {
                            const asset = assetsMap.get(item.asset_id)
                            return (
                              <li
                                key={`${item.asset_id}-${index}`}
                                className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg"
                              >
                                <span className="text-sm text-slate-900 dark:text-white">
                                  {index + 1}. {asset?.filename || tLibrary('playlists.messages.unknownAsset')}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeAssetFromPlaylist(index)}
                                  className="text-error-600 hover:text-error-800 dark:text-error-400 dark:hover:text-error-300 text-sm font-medium"
                                >
                                  {tLibrary('playlists.actions.remove')}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                          {tLibrary('playlists.messages.noAssets')}
                        </p>
                      )}

                      {availableAssets.length > 0 ? (
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              addAssetToPlaylist(e.target.value)
                              e.target.value = ''
                            }
                          }}
                          className="block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-slate-900 dark:text-white focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-colors"
                          defaultValue=""
                        >
                          <option value="" disabled>
                            {tLibrary('playlists.fields.selectAsset')}
                          </option>
                          {availableAssets.map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.filename}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {tLibrary('playlists.messages.noAvailableAssets')}
                        </p>
                      )}
                    </div>
                    <div className="flex justify-end gap-3">
                      <Button type="button" onClick={resetPlaylistForm} variant="secondary">
                        {actionLabels('cancel')}
                      </Button>
                      <Button
                        type="submit"
                        isLoading={createPlaylistMutation.isPending || updatePlaylistMutation.isPending}
                      >
                        {editingPlaylistId
                          ? tLibrary('playlists.actions.update')
                          : tLibrary('playlists.actions.createShort')}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {isLoadingPlaylists ? (
              <LoadingState />
            ) : playlists && playlists.length > 0 ? (
              <div className="grid gap-4">
                {playlists.map((playlist) => (
                  <Card key={playlist.id} className="animate-slide-up">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-3">
                            <List className="h-5 w-5 text-primary-500" />
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                              {playlist.name}
                            </h3>
                            {playlist.loop && (
                              <Badge variant="secondary" className="gap-1">
                                <PlayCircle className="h-3 w-3" />
                                {tLibrary('playlists.badges.loop')}
                              </Badge>
                            )}
                          </div>
                          {playlist.description && (
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                              {playlist.description}
                            </p>
                          )}
                          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                            {tLibrary('playlists.labels.items', { count: playlist.items?.length || 0 })}
                          </div>
                          {playlist.items && playlist.items.length > 0 && (
                            <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                              {playlist.items.slice(0, 3).map((item, index) => (
                                <li key={`${item.id}-${index}`} className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                                    {index + 1}.
                                  </span>
                                  {assetsMap.get(item.asset_id)?.filename || tLibrary('playlists.messages.unknownAsset')}
                                </li>
                              ))}
                              {playlist.items.length > 3 && (
                                <li className="text-slate-400 dark:text-slate-500 italic">
                                  {tLibrary('playlists.labels.moreItems', { count: playlist.items.length - 3 })}
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                        <div className="flex gap-2 ml-4">
                          <Button
                            onClick={() => handleEditPlaylist(playlist)}
                            variant="secondary"
                            size="sm"
                            className="gap-2"
                          >
                            <Edit className="h-4 w-4" />
                            {tLibrary('playlists.actions.editButton')}
                          </Button>
                          <Button
                            onClick={() => handleDeletePlaylist(playlist.id)}
                            variant="danger"
                            size="sm"
                            isLoading={deletePlaylistMutation.isPending}
                            className="gap-2"
                          >
                            <Trash2 className="h-4 w-4" />
                            {tLibrary('playlists.actions.delete')}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="text-center py-12">
                <CardContent>
                  <List className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-600 mb-4" />
                  <p className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                    {tLibrary('playlists.messages.emptyTitle')}
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 mb-6">
                    {tLibrary('playlists.messages.emptyDescription')}
                  </p>
                  <Button onClick={() => setShowCreatePlaylist(true)} className="gap-2">
                    <Plus className="h-4 w-4" />
                    {tLibrary('playlists.messages.emptyCta')}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold gradient-text">{totalAssets}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tLibrary('stats.videos')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold gradient-text">{totalPlaylists}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tLibrary('stats.playlists')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold gradient-text">{formatBytes(totalStorage)}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{tLibrary('stats.storage')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upload Modal */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        uppy={uppy}
        isProcessingUpload={isProcessingUpload}
      />

      {assetBeingRenamed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-md shadow-2xl">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{tLibrary('rename.title')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {tLibrary('rename.description')}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={closeRenameModal}>
                  <X className="h-5 w-5" />
                  <span className="sr-only">{actionLabels('close')}</span>
                </Button>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  submitRename()
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {tLibrary('rename.label')}
                  </label>
                  <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={closeRenameModal}>
                    {actionLabels('cancel')}
                  </Button>
                  <Button type="submit" isLoading={updateAssetMutation.isPending} className="gap-2">
                    {tLibrary('rename.save')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {checkModalAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-2xl shadow-2xl">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{tLibrary('validation.title')}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {tLibrary('validation.description', { filename: checkModalAsset.filename })}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={closeCheckModal}>
                  <X className="h-5 w-5" />
                  <span className="sr-only">{actionLabels('close')}</span>
                </Button>
              </div>

              {isCheckModalLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p>{tLibrary('validation.loading')}</p>
                </div>
              ) : checkModalInfo ? (
                <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={checkModalAsset.compatible_for_copy ? 'success' : 'error'}>
                      {checkModalAsset.compatible_for_copy
                        ? tLibrary('assets.badges.ready')
                        : tLibrary('assets.badges.needsEncoding')}
                    </Badge>
                    {checkModalInfo.bitrateStatus === 'within' ? (
                      <Badge variant="success">{tLibrary('assets.badges.bitrateOk')}</Badge>
                    ) : checkModalInfo.bitrateStatus === 'outside' ? (
                      <Badge variant="warning">{tLibrary('assets.badges.bitrateCheck')}</Badge>
                    ) : null}
                  </div>

                  {!checkModalAsset.compatible_for_copy && (
                    <div className="text-sm text-error-600 dark:text-error-400">
                      {tLibrary('assets.messages.incompatibleSummary')}
                      {checkModalInfo.issues.length > 0 && (
                        <span className="block text-xs text-error-500/90 dark:text-error-300">
                          {checkModalInfo.issues[0]}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {tLibrary('assets.metadata.video')}
                      </span>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{checkModalInfo.videoCodec?.toUpperCase() ?? '—'}</Badge>
                        <span>{formatBitrateDisplay(checkModalInfo.videoBitrate)}</span>
                        <span>·</span>
                        <span>
                          {checkModalInfo.videoWidth && checkModalInfo.videoHeight
                            ? `${checkModalInfo.videoWidth}×${checkModalInfo.videoHeight}`
                            : '—'}
                        </span>
                        <span>·</span>
                        <span>{formatFpsDisplay(checkModalInfo.videoFps)}</span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {tLibrary('assets.metadata.audio')}
                      </span>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{checkModalInfo.audioCodec?.toUpperCase() ?? '—'}</Badge>
                        <span>{formatBitrateDisplay(checkModalInfo.audioBitrate)}</span>
                        <span>·</span>
                        <span>{formatSampleRateDisplay(checkModalInfo.audioSampleRate)}</span>
                        {checkModalInfo.audioChannels ? (
                          <>
                            <span>·</span>
                            <span>{tLibrary('assets.metadata.channels', { count: checkModalInfo.audioChannels })}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {checkModalInfo.recommendationLabel ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <CheckCircle className="w-4 h-4 text-primary-500" />
                      <span>
                        {tLibrary('assets.recommendations', {
                          label: checkModalInfo.recommendationLabel,
                          details: checkModalInfo.recommendationDetails,
                        })}
                      </span>
                    </div>
                  ) : null}

                  {(checkModalInfo.issues.length > 0 || checkModalInfo.warnings.length > 0) && (
                    <div className="space-y-2">
                      {checkModalInfo.issues.map((issue, index) => (
                        <div
                          key={`modal-issue-${index}`}
                          className="flex items-start text-sm text-error-600 dark:text-error-400"
                        >
                          <XCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                          <span>{issue}</span>
                        </div>
                      ))}
                      {checkModalInfo.warnings.map((warning, index) => (
                        <div
                          key={`modal-warning-${index}`}
                          className="flex items-start text-sm text-amber-600 dark:text-amber-400"
                        >
                          <AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                          <span>{formatWarningMessage(warning)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {tLibrary('validation.unavailable')}
                </p>
              )}

              <div className="flex justify-end">
                <Button onClick={closeCheckModal}>{tLibrary('validation.close')}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
