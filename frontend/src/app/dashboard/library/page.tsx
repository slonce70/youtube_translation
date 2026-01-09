'use client'

import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Uppy from '@uppy/core'
import type { UploadResult } from '@uppy/core'
import Tus from '@uppy/tus'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { 
  AlertCircle, Upload, ListVideo, Plus, CheckCircle, XCircle, Clock, 
  List, PlayCircle, CalendarClock, Edit, Trash2, ChevronDown, ChevronUp, Loader2, X,
  Folder, FolderPlus, CheckSquare, Square, MinusSquare
} from 'lucide-react'
import { format } from 'date-fns'

import { api, ApiError } from '@/lib/api'
import { formatBytes, formatDuration, isValidUUID } from '@/lib/utils'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Input } from '@/components/ui/Input'
import type {
  Asset,
  AssetUsageReference,
  MediaFolder,
  Playlist,
  PlaylistCreatePayload,
  PlaylistItemInput,
  PlaylistUpdatePayload,
} from '@/lib/types'
import { UploadModal } from '@/components/upload/UploadModal'
import { AssetActionsMenu } from '@/components/AssetActionsMenu'
import {
  deriveAssetDisplayInfo,
  formatBitrateDisplay,
  formatFpsDisplay,
  formatSampleRateDisplay,
  type AssetDisplayInfo,
  type AssetWarning,
} from './asset-utils'
import { useDashboardContext } from '../dashboard-context'
import { Breadcrumbs } from '@/components/library/Breadcrumbs'
import { FolderCard } from '@/components/library/FolderCard'
import { AssetCard } from '@/components/library/AssetCard'

type AssetFilterValue = 'all' | 'video' | 'audio'
type PlaylistFormState = PlaylistCreatePayload & { description: string }

export default function LibraryPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useDashboardContext()
  const libraryToasts = useTranslations('library.toasts')
  const tLibrary = useTranslations('library.page')
  const tFolders = useTranslations('library.folders')
  const tUploadModal = useTranslations('library.uploadModal')
  const tAssetWarnings = useTranslations('library.page.assets.warnings')
  const actionLabels = useTranslations('common.actions')

  const buildLibraryRoute = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const nextParams = new URLSearchParams(searchParams.toString())
      Object.entries(updates).forEach(([key, value]) => {
        if (!value) {
          nextParams.delete(key)
        } else {
          nextParams.set(key, value)
        }
      })
      const queryString = nextParams.toString()
      return `/dashboard/library${queryString ? `?${queryString}` : ''}`
    },
    [searchParams]
  )

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
  const deriveAssetFilter = useCallback((value: string | null): AssetFilterValue => {
    if (value === 'video' || value === 'audio') {
      return value
    }
    return 'all'
  }, [])
  const deriveFolderSelection = useCallback((value: string | null): string | 'all' => {
    if (!value) {
      return 'all'
    }
    return value
  }, [])

  const [assetFilter, setAssetFilter] = useState<AssetFilterValue>(
    deriveAssetFilter(searchParams.get('type'))
  )
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>(
    deriveFolderSelection(searchParams.get('folder'))
  )

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && (tab === 'assets' || tab === 'playlists')) {
      setActiveTab(tab)
    }
    setAssetFilter(deriveAssetFilter(searchParams.get('type')))
    setSelectedFolderId(deriveFolderSelection(searchParams.get('folder')))
  }, [searchParams, deriveAssetFilter, deriveFolderSelection])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    router.push(buildLibraryRoute({ tab }), { scroll: false })
  }

  const handleAssetFilterChange = (filter: AssetFilterValue) => {
    if (assetFilter === filter) return
    setAssetFilter(filter)
    router.push(
      buildLibraryRoute({ type: filter === 'all' ? null : filter }),
      { scroll: false }
    )
  }

  const handleFolderSelect = (folderId: string | 'all') => {
    setSelectedFolderId(folderId)
    setSelectedAssets(new Set())
    router.push(
      buildLibraryRoute({ folder: folderId === 'all' ? null : folderId }),
      { scroll: false }
    )
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
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set())
  const [pendingDeletionIds, setPendingDeletionIds] = useState<Set<string>>(new Set())
  const [moveModalState, setMoveModalState] = useState<{ open: boolean; assetIds: string[] }>({
    open: false,
    assetIds: [],
  })
  const [uploadTokenState, setUploadTokenState] = useState<{ token: string; expiresAt: number } | null>(null)
  const [deleteModalState, setDeleteModalState] = useState<{
    open: boolean
    assetIds: string[]
    forceRequired: boolean
    forceTarget?: {
      assetId: string
      name?: string
      usage?: Asset['usage']
    }
  }>({
    open: false,
    assetIds: [],
    forceRequired: false,
  })
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>('')
  const [draggedAssetIds, setDraggedAssetIds] = useState<string[] | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | 'all' | null>(null)
  const [folderModalState, setFolderModalState] = useState<
    { mode: 'create' | 'rename' | 'delete'; folder: MediaFolder | null } | null
  >(null)
  const [folderNameInput, setFolderNameInput] = useState('')

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
        allowedFileTypes: ['video/*', 'audio/*'],
        maxFileSize: 10 * 1024 * 1024 * 1024, // 10 GB
      },
    })
  )

  useEffect(() => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
        const uploadedFiles = result.successful.map((file) => ({
          name: file.name,
          size: typeof file.size === 'number' ? file.size : undefined,
        }))

        const shouldVerifyPresence = assetFilter === 'all'
        const activeAssetsKey: [string, string | undefined, AssetFilterValue, string | 'all'] = [
          'assets',
          user?.id,
          assetFilter,
          selectedFolderId,
        ]

        const refreshUntilVisible = async () => {
          const pollSchedule = [0, 350, 900, 1600]
          for (const delayMs of pollSchedule) {
            if (delayMs) {
              await sleep(delayMs)
            }
            await queryClient.invalidateQueries({ queryKey: ['assets', user?.id] })
            await queryClient.refetchQueries({ queryKey: ['assets', user?.id], type: 'active' })

            if (!shouldVerifyPresence || !uploadedFiles.length) {
              continue
            }

            const currentAssets = queryClient.getQueryData<Asset[]>(activeAssetsKey)
            if (
              currentAssets &&
              uploadedFiles.every((file) =>
                currentAssets.some((asset) => {
                  if (asset.filename !== file.name) return false
                  if (file.size === undefined) return true
                  return Math.abs(asset.size_bytes - file.size) <= 1
                })
              )
            ) {
              return
            }
          }
        }

        await refreshUntilVisible()
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
  }, [assetFilter, selectedFolderId, libraryToasts, queryClient, tusEndpoint, uppy, user?.id])

  const refreshUploadToken = useCallback(async () => {
    if (!user?.id) {
      setUploadTokenState(null)
      return
    }

    try {
      const response = await api.assets.createUploadToken()
      const expiresAt = new Date(response.expires_at).getTime()
      setUploadTokenState({ token: response.token, expiresAt })
      uppy.setMeta({ upload_token: response.token })
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : (error as Error)?.message ?? 'Unable to refresh upload token'
      toast.error(libraryToasts('generic.errorWithMessage', { message }))
    }
  }, [libraryToasts, uppy, user?.id])

  useEffect(() => {
    if (!user?.id) {
      setUploadTokenState(null)
      return
    }
    void refreshUploadToken()
  }, [refreshUploadToken, user?.id])

  useEffect(() => {
    if (!uploadTokenState || typeof window === 'undefined') {
      return
    }

    const now = Date.now()
    const refreshIn = Math.max(uploadTokenState.expiresAt - now - 60_000, 5_000)
    const timer = window.setTimeout(() => {
      void refreshUploadToken()
    }, refreshIn)

    return () => {
      window.clearTimeout(timer)
    }
  }, [refreshUploadToken, uploadTokenState])

  useEffect(() => {
    if (!user?.id) {
      return
    }
    const meta: Record<string, string> = { user_id: user.id }
    if (uploadTokenState?.token) {
      meta.upload_token = uploadTokenState.token
    }
    uppy.setMeta(meta)
  }, [uppy, uploadTokenState?.token, user?.id])

  // API Queries
  const { data: assets, isLoading: isLoadingAssets } = useQuery<Asset[]>({
    queryKey: ['assets', user?.id, assetFilter, selectedFolderId],
    queryFn: () =>
      api.assets.list(
        assetFilter === 'all'
          ? selectedFolderId === 'all'
            ? undefined
            : { folder_id: selectedFolderId }
          : {
              asset_type: assetFilter,
              folder_id: selectedFolderId === 'all' ? undefined : selectedFolderId,
            }
      ),
    enabled: !!user,
  })

  const {
    data: folders,
    isLoading: isLoadingFolders,
    isError: isFoldersError,
  } = useQuery<MediaFolder[]>({
    queryKey: ['media-folders', user?.id],
    queryFn: () => api.mediaFolders.list(),
    enabled: !!user,
  })

  const { data: playlists, isLoading: isLoadingPlaylists } = useQuery<Playlist[]>({
    queryKey: ['playlists', user?.id],
    queryFn: () => api.playlists.list(),
    enabled: !!user,
  })

  const rootFolderId = useMemo(() => {
    if (!folders || folders.length === 0) return null
    const root = folders.find((folder) => folder.is_root)
    return root ? root.id : null
  }, [folders])

  const assetMap = useMemo(() => {
    if (!assets) {
      return new Map<string, Asset>()
    }
    return new Map(assets.map((asset) => [asset.id, asset]))
  }, [assets])

  useEffect(() => {
    if (!assets) return
    setSelectedAssets((prev) => {
      if (prev.size === 0) return prev
      const allowedIds = new Set(assets.map((asset) => asset.id))
      const next = new Set<string>()
      let changed = false
      prev.forEach((id) => {
        if (allowedIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      })
      if (changed || next.size !== prev.size) {
        return next
      }
      return prev
    })
  }, [assets])

  // Mutations
  const revalidateAssetMutation = useMutation({
    mutationFn: (assetId: string) => api.assets.revalidate(assetId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assets', user?.id] })
    },
    onError: (error: Error) => {
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const updateAssetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { filename?: string } }) =>
      api.assets.update(id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assets', user?.id] })
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

  const moveAssetsMutation = useMutation({
    mutationFn: ({ folderId, assetIds }: { folderId: string | null; assetIds: string[] }) => {
      if (!folderId || !isValidUUID(folderId)) {
        return Promise.reject(new Error(libraryToasts('folder.invalidTarget')))
      }
      const validIds = assetIds.filter((candidate) => {
        if (!isValidUUID(candidate)) {
          return false
        }
        return assetMap.has(candidate)
      })
      if (validIds.length === 0) {
        return Promise.reject(new Error(libraryToasts('asset.invalidSelection')))
      }
      return api.mediaFolders.bulkMoveAssets(folderId, {
        asset_ids: validIds,
        exclusive: true,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets', user?.id] })
      toast.success(libraryToasts('asset.moved'))
    },
    onError: (error: Error) => {
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const createFolderMutation = useMutation({
    mutationFn: (data: { name: string; parent_id?: string | null }) =>
      api.mediaFolders.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-folders', user?.id] })
      toast.success(libraryToasts('folder.created'))
    },
    onError: (error: Error) => {
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const updateFolderMutation = useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      api.mediaFolders.update(folderId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-folders', user?.id] })
      toast.success(libraryToasts('folder.updated'))
    },
    onError: (error: Error) => {
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const deleteFolderMutation = useMutation({
    mutationFn: (folderId: string) => api.mediaFolders.delete(folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-folders', user?.id] })
      toast.success(libraryToasts('folder.deleted'))
    },
    onError: (error: Error) => {
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message }))
    },
  })

  const createPlaylistMutation = useMutation({
    mutationFn: (data: PlaylistCreatePayload) => api.playlists.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists', user?.id] })
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
      queryClient.invalidateQueries({ queryKey: ['playlists', user?.id] })
      toast.success(libraryToasts('playlist.updated'))
      resetPlaylistForm()
    },
    onError: (error: Error) =>
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message })),
  })

  const deletePlaylistMutation = useMutation({
    mutationFn: (playlistId: string) => api.playlists.delete(playlistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists', user?.id] })
      toast.success(libraryToasts('playlist.deleted'))
    },
    onError: (error: Error) =>
      toast.error(libraryToasts('generic.errorWithMessage', { message: error.message })),
  })

  const folderChildren = useMemo(() => {
    const map = new Map<string | null, MediaFolder[]>()
    ;(folders ?? []).forEach((folder) => {
      const key = folder.parent_id ?? null
      const siblings = map.get(key) ?? []
      siblings.push(folder)
      map.set(key, siblings)
    })
    map.forEach((children) => {
      children.sort((a, b) => a.name.localeCompare(b.name))
    })
    return map
  }, [folders])

  const renderFolderSelectionTree = (parentId: string | null, depth = 0): JSX.Element[] => {
    const children = folderChildren.get(parentId) ?? []
    return children.map((folder) => (
      <div key={`move-${folder.id}`}>
        <button
          type="button"
          onClick={() => setMoveTargetFolderId(folder.id)}
          className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
            moveTargetFolderId === folder.id
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-100'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
          style={{ paddingLeft: depth ? depth * 12 : 0 }}
        >
          <span className="truncate">{folder.name}</span>
          {moveTargetFolderId === folder.id && <CheckCircle className="h-4 w-4" />}
        </button>
        {renderFolderSelectionTree(folder.id, depth + 1)}
      </div>
    ))
  }

  const selectedAssetCount = selectedAssets.size
  const hasSelection = selectedAssetCount > 0
  const selectedAssetsArray = useMemo(() => Array.from(selectedAssets), [selectedAssets])
  const allVisibleSelected = Boolean(
    assets && assets.length > 0 && selectedAssetCount === assets.length
  )
  const isPartiallySelected = Boolean(
    assets && selectedAssetCount > 0 && selectedAssetCount < assets.length
  )

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssets((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) {
        next.delete(assetId)
      } else {
        next.add(assetId)
      }
      return next
    })
  }

  const selectAllVisibleAssets = () => {
    if (!assets || assets.length === 0) {
      setSelectedAssets(new Set())
      return
    }
    setSelectedAssets(new Set(assets.map((asset) => asset.id)))
  }

  const clearAssetSelection = () => {
    setSelectedAssets(new Set())
  }

  const openMoveModal = (assetIds: string[]) => {
    if (!assetIds.length) return
    setMoveModalState({ open: true, assetIds })
    const defaultTarget = selectedFolderId === 'all' ? rootFolderId ?? '' : selectedFolderId
    setMoveTargetFolderId(defaultTarget ?? '')
  }

  const closeMoveModal = () => {
    setMoveModalState({ open: false, assetIds: [] })
    setMoveTargetFolderId('')
  }

  const openDeleteModal = (assetIds: string[]) => {
    if (!assetIds.length) return
    setDeleteModalState({
      open: true,
      assetIds,
      forceRequired: false,
      forceTarget: undefined,
    })
  }

  const closeDeleteModal = () => {
    setDeleteModalState({
      open: false,
      assetIds: [],
      forceRequired: false,
      forceTarget: undefined,
    })
  }

  const openCreateFolderModal = () => {
    const parent =
      selectedFolderId === 'all'
        ? folders?.find((folder) => folder.is_root) ?? null
        : folders?.find((folder) => folder.id === selectedFolderId) ?? null
    setFolderModalState({ mode: 'create', folder: parent })
    setFolderNameInput('')
  }

  const openRenameFolderModal = (folder: MediaFolder) => {
    setFolderModalState({ mode: 'rename', folder })
    setFolderNameInput(folder.name)
  }

  const openDeleteFolderModal = (folder: MediaFolder) => {
    setFolderModalState({ mode: 'delete', folder })
  }

  const closeFolderModal = () => {
    setFolderModalState(null)
    setFolderNameInput('')
  }

  const resolveAssetsByIds = useCallback(
    (ids: string[]) =>
      ids
        .map((id) => assetMap.get(id))
        .filter((asset): asset is Asset => Boolean(asset)),
    [assetMap]
  )

  const formatUsageLabel = useCallback(
    (type: 'streams' | 'collections' | 'playlists', count: number) => {
      if (!count) return null
      return tLibrary(`assets.usage.${type}` as any, { count })
    },
    [tLibrary]
  )

  const renderForceUsageList = (
    label: 'streams' | 'collections' | 'playlists',
    items?: AssetUsageReference[]
  ) => {
    if (!items || items.length === 0) {
      return null
    }
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {tLibrary(`assets.selection.forceUsage.${label}` as const)}
        </p>
        <ul className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
          {items.map((item) => (
            <li
              key={`${label}-${item.id}`}
              className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-800/40"
            >
              <span className="truncate">
                {item.name || tLibrary('assets.selection.forceUnknown')}
              </span>
              {item.status && (
                <span className="text-xs text-slate-400 dark:text-slate-500">{item.status}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const handleAssetDragStart = (event: DragEvent<HTMLDivElement>, assetId: string) => {
    const payload =
      selectedAssets.has(assetId) && selectedAssetCount > 0
        ? selectedAssetsArray
        : [assetId]
    setDraggedAssetIds(payload)
    setDragOverFolderId(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', payload.join(','))
  }

  const handleAssetDragEnd = () => {
    setDraggedAssetIds(null)
    setDragOverFolderId(null)
  }

  const handleFolderDrop = async (targetId: string | 'all') => {
    if (!draggedAssetIds || draggedAssetIds.length === 0) return
    const folderTarget = targetId === 'all' ? rootFolderId : targetId
    if (!folderTarget || !isValidUUID(folderTarget)) {
      toast.error(libraryToasts('folder.invalidTarget'))
      return
    }
    try {
      await moveAssetsMutation.mutateAsync({ folderId: folderTarget, assetIds: draggedAssetIds })
      setSelectedAssets((prev) => {
        const next = new Set(prev)
        draggedAssetIds.forEach((id) => next.delete(id))
        return next
      })
    } catch (error) {
      // handled via mutation toast
    } finally {
      setDraggedAssetIds(null)
      setDragOverFolderId(null)
    }
  }

  const moveModalAssets = useMemo(
    () => resolveAssetsByIds(moveModalState.assetIds),
    [moveModalState.assetIds, resolveAssetsByIds]
  )

  const deleteModalAssets = useMemo(
    () => resolveAssetsByIds(deleteModalState.assetIds),
    [deleteModalState.assetIds, resolveAssetsByIds]
  )

  const deleteSelectionHasUsage = useMemo(() => {
    if (!deleteModalAssets.length) return false
    return deleteModalAssets.some((asset) => {
      const usage = asset.usage
      const playlists = usage?.playlists?.length ?? 0
      const collections = usage?.collections?.length ?? 0
      const streams = usage?.streams?.length ?? 0
      return playlists + collections + streams > 0
    })
  }, [deleteModalAssets])

  const forceTargetUsage = deleteModalState.forceTarget?.usage

  const isDeletingSelection = deleteModalState.assetIds.some((id) =>
    pendingDeletionIds.has(id)
  )
  const isFolderSubmitting =
    createFolderMutation.isPending ||
    updateFolderMutation.isPending ||
    deleteFolderMutation.isPending

  // Handlers
  const handleDeleteAsset = (assetId: string) => {
    openDeleteModal([assetId])
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

  const markAssetsAsDeleting = (assetIds: string[], pending: boolean) => {
    setPendingDeletionIds((prev) => {
      const next = new Set(prev)
      assetIds.forEach((id) => {
        if (pending) {
          next.add(id)
        } else {
          next.delete(id)
        }
      })
      return next
    })
  }

  const deleteAssets = async (assetIds: string[]) => {
    if (!assetIds.length) return
    markAssetsAsDeleting(assetIds, true)
    try {
      for (const assetId of assetIds) {
        try {
          await api.assets.delete(assetId)
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const conflictAsset = resolveAssetsByIds([assetId])[0]
            const detail = (error.detail as { usage?: Asset['usage'] }) ?? {}
            setDeleteModalState((prev) => ({
              ...prev,
              open: true,
              forceRequired: true,
              forceTarget: {
                assetId,
                name: conflictAsset?.filename ?? assetId,
                usage: detail.usage ?? conflictAsset?.usage,
              },
            }))
            toast.warning(libraryToasts('asset.forceToast'))
            return
          }
          throw error
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['assets', user?.id] })
      toast.success(libraryToasts('asset.deleted'))
      setSelectedAssets((prev) => {
        const next = new Set(prev)
        assetIds.forEach((id) => next.delete(id))
        return next
      })
      closeDeleteModal()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete assets'
      toast.error(libraryToasts('generic.errorWithMessage', { message }))
      closeDeleteModal()
    } finally {
      markAssetsAsDeleting(assetIds, false)
    }
  }

  const handleConfirmDelete = async () => {
    const ids = deleteModalState.assetIds
    if (!ids.length) {
      closeDeleteModal()
      return
    }
    if (deleteModalState.forceRequired) {
      toast.error(libraryToasts('asset.forceToast'))
      return
    }
    await deleteAssets(ids)
    // Modal is closed in deleteAssets on success or error (except 409)
  }

  const handleConfirmMove = async () => {
    if (!moveModalState.assetIds.length || !moveTargetFolderId) {
      return
    }
    try {
      await moveAssetsMutation.mutateAsync({
        folderId: moveTargetFolderId,
        assetIds: moveModalState.assetIds,
      })
      setSelectedAssets((prev) => {
        const next = new Set(prev)
        moveModalState.assetIds.forEach((id) => next.delete(id))
        return next
      })
      closeMoveModal()
    } catch (error) {
      // toast handled in mutation
    }
  }

  const handleFolderModalSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!folderModalState) return
    const trimmed = folderNameInput.trim()
    if (!trimmed) {
      toast.error(libraryToasts('asset.renameEmpty'))
      return
    }
    try {
      if (folderModalState.mode === 'create') {
        await createFolderMutation.mutateAsync({
          name: trimmed,
          parent_id: folderModalState.folder?.id,
        })
      } else if (folderModalState.mode === 'rename' && folderModalState.folder) {
        await updateFolderMutation.mutateAsync({
          folderId: folderModalState.folder.id,
          name: trimmed,
        })
      }
      closeFolderModal()
    } catch (error) {
      // errors handled by mutation toasts
    }
  }

  const handleFolderDelete = async () => {
    if (!folderModalState?.folder) return
    try {
      await deleteFolderMutation.mutateAsync(folderModalState.folder.id)
      if (selectedFolderId === folderModalState.folder.id) {
        setSelectedFolderId('all')
      }
      closeFolderModal()
    } catch (error) {
      // toast handled in mutation
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

  const availableAssets = useMemo<Asset[]>(() => {
    if (!assets) return [] as Asset[]
    return assets
      .filter((asset) => asset.compatible_for_copy)
      .filter((asset) => !playlistForm.items.some((item) => item.asset_id === asset.id))
  }, [assets, playlistForm.items])

  // Get folders in current directory
  const currentFolders = useMemo(() => {
    if (!folders || folders.length === 0) return []
    
    // Determine parent_id for current view
    let parentId: string | null = null
    if (selectedFolderId !== 'all') {
      parentId = selectedFolderId
    } else {
      // Show root folders when in "all" view
      parentId = null
    }
    
    return folders
      .filter((folder) => folder.parent_id === parentId || (parentId === null && folder.is_root))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [folders, selectedFolderId])

  // Calculate item count for each folder (recursive)
  const folderItemCounts = useMemo(() => {
    if (!folders || !assets) return new Map<string, number>()
    
    const counts = new Map<string, number>()
    
    // Helper to get all descendant folder IDs
    const getDescendantIds = (folderId: string): string[] => {
      const descendants: string[] = [folderId]
      const children = folders.filter((f) => f.parent_id === folderId)
      children.forEach((child) => {
        descendants.push(...getDescendantIds(child.id))
      })
      return descendants
    }
    
    // Count assets in each folder and its descendants
    folders.forEach((folder) => {
      const folderIds = getDescendantIds(folder.id)
      const count = assets.filter((asset) => {
        return asset.folders?.some((af) => folderIds.includes(af.folder_id))
      }).length
      counts.set(folder.id, count)
    })
    
    return counts
  }, [folders, assets])

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
            {/* Breadcrumbs Navigation */}
            <Breadcrumbs
              currentFolderId={selectedFolderId}
              folders={folders}
              onNavigate={handleFolderSelect}
              onDrop={handleFolderDrop}
            />

            {/* Header with Actions */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold">{tLibrary('assets.title')}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {tLibrary('assets.filters.label')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { value: 'all', label: tLibrary('assets.filters.all') },
                    { value: 'video', label: tLibrary('assets.filters.video') },
                    { value: 'audio', label: tLibrary('assets.filters.audio') },
                  ] as { value: AssetFilterValue; label: string }[]
                ).map((option) => (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={assetFilter === option.value ? 'primary' : 'outline'}
                    onClick={() => handleAssetFilterChange(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openCreateFolderModal}
                  className="gap-2"
                >
                  <FolderPlus className="w-4 h-4" />
                  {tFolders('create')}
                </Button>
                <Button onClick={() => setIsUploadOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  {tLibrary('assets.upload')}
                </Button>
              </div>
            </div>

              {assets && assets.length > 0 && (
                <div className="rounded-md border border-slate-200/80 bg-slate-50/60 px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        if (allVisibleSelected) {
                          clearAssetSelection()
                        } else {
                          selectAllVisibleAssets()
                        }
                      }}
                      className="inline-flex items-center gap-2 text-left font-medium text-slate-700 transition-colors hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
                    >
                      {allVisibleSelected ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : isPartiallySelected ? (
                        <MinusSquare className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                      <span>{tLibrary('assets.selection.selectAll')}</span>
                    </button>
                    {hasSelection && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {tLibrary('assets.selection.count', { count: selectedAssetCount })}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openMoveModal(selectedAssetsArray)}
                          >
                            {tLibrary('assets.selection.move')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => openDeleteModal(selectedAssetsArray)}
                          >
                            {tLibrary('assets.selection.delete')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={clearAssetSelection}>
                            {tLibrary('assets.selection.clear')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

            {isLoadingAssets || isLoadingFolders ? (
              <LoadingState />
            ) : (
              <div className="space-y-4">
                {/* Render folders in grid */}
                {currentFolders.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {currentFolders.map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        itemCount={folderItemCounts.get(folder.id) || 0}
                        onOpen={handleFolderSelect}
                        onRename={!folder.is_root ? openRenameFolderModal : undefined}
                        onDelete={!folder.is_root ? openDeleteFolderModal : undefined}
                        onDragOver={(event) => {
                          if (!draggedAssetIds || draggedAssetIds.length === 0) return
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                          setDragOverFolderId(folder.id)
                        }}
                        onDragLeave={() => {
                          if (dragOverFolderId === folder.id) {
                            setDragOverFolderId(null)
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          handleFolderDrop(folder.id)
                        }}
                        isDragOver={dragOverFolderId === folder.id}
                      />
                    ))}
                  </div>
                )}

                {/* Render assets as list */}
                {assets && assets.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {assets.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        isSelected={selectedAssets.has(asset.id)}
                        onSelect={(checked) => {
                          if (checked) {
                            setSelectedAssets((prev) => new Set(prev).add(asset.id))
                          } else {
                            setSelectedAssets((prev) => {
                              const next = new Set(prev)
                              next.delete(asset.id)
                              return next
                            })
                          }
                        }}
                        onRename={() => handleRenameAsset(asset)}
                        onDelete={() => handleDeleteAsset(asset.id)}
                        onCheck={() => handleCheckAsset(asset)}
                        onMove={() => openMoveModal([asset.id])}
                        onDownload={() => handleDownloadAsset(asset)}
                        onPlaylistAdd={() => handleNotImplemented(tLibrary('assets.menu.items.playlists'))}
                        onOptimize={() => handleNotImplemented(tLibrary('assets.menu.items.optimize'))}
                        onDragStart={(event) => handleAssetDragStart(event, asset.id)}
                        onDragEnd={handleAssetDragEnd}
                        isDeleting={pendingDeletionIds.has(asset.id)}
                        isChecking={checkingAssetId === asset.id}
                        isGeneratingDownload={downloadAssetId === asset.id && downloadLinkMutation.isPending}
                        formatWarningMessage={formatWarningMessage}
                        formatUsageLabel={formatUsageLabel}
                        t={{
                          filters: { audio: tLibrary('assets.filters.audio') },
                          badges: {
                            ready: tLibrary('assets.badges.ready'),
                            needsEncoding: tLibrary('assets.badges.needsEncoding'),
                            bitrateOk: tLibrary('assets.badges.bitrateOk'),
                            bitrateCheck: tLibrary('assets.badges.bitrateCheck'),
                          },
                          messages: { incompatibleSummary: tLibrary('assets.messages.incompatibleSummary') },
                          details: {
                            hide: tLibrary('assets.details.hide'),
                            show: tLibrary('assets.details.show'),
                          },
                          metadata: {
                            video: tLibrary('assets.metadata.video'),
                            audio: tLibrary('assets.metadata.audio'),
                            channels: (count: number) => tLibrary('assets.metadata.channels', { count }),
                          },
                          recommendations: (params: { label: string; details: string }) =>
                            tLibrary('assets.recommendations', params),
                          selection: { checkboxLabel: tLibrary('assets.selection.checkboxLabel') },
                          previewAlt: (params: { filename: string }) => tLibrary('assets.previewAlt', params),
                        }}
                      />
                    ))}
                  </div>
                ) : null}

                {/* Empty state - shown when no folders and no assets */}
                {!currentFolders.length && (!assets || assets.length === 0) && (
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
                            const asset = assetMap.get(item.asset_id)
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
                                  {assetMap.get(item.asset_id)?.filename || tLibrary('playlists.messages.unknownAsset')}
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
        folders={folders}
      />

      {moveModalState.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 py-6">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {tLibrary('assets.selection.bulkMoveTitle')}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {tLibrary('assets.selection.bulkMoveDescription')}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeMoveModal} aria-label={actionLabels('close')}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {tLibrary('assets.selection.targetLabel')}
                </p>
                <div className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 px-2 py-2 dark:border-slate-700">
                  {rootFolderId && (
                    <button
                      type="button"
                      onClick={() => setMoveTargetFolderId(rootFolderId)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
                        moveTargetFolderId === rootFolderId
                          ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-100'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">{tUploadModal('folder.rootOption')}</span>
                      {moveTargetFolderId === rootFolderId && <CheckCircle className="h-4 w-4" />}
                    </button>
                  )}
                  {renderFolderSelectionTree(rootFolderId ?? null)}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {tLibrary('assets.selection.count', { count: moveModalAssets.length })}
                </p>
                <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                  {moveModalAssets.length > 0 ? (
                    <ul className="space-y-1">
                      {moveModalAssets.map((asset) => (
                        <li key={`moving-${asset.id}`} className="truncate">
                          {asset.filename}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-500 dark:text-slate-400">
                      {tAssetWarnings('unknownValue')}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" onClick={closeMoveModal}>
                {tLibrary('assets.selection.cancel')}
              </Button>
              <Button
                onClick={handleConfirmMove}
                disabled={!moveTargetFolderId}
                isLoading={moveAssetsMutation.isPending}
              >
                {tLibrary('assets.selection.moveConfirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteModalState.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 py-6">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {tLibrary('assets.selection.deleteTitle')}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {tLibrary('assets.selection.deleteDescription')}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeDeleteModal} aria-label={actionLabels('close')}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {deleteSelectionHasUsage && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <p>{tLibrary('assets.selection.deleteUsageWarning')}</p>
              </div>
            )}

            {deleteModalState.forceRequired && (
              <div className="mt-4 space-y-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-400/60 dark:bg-rose-500/10 dark:text-rose-100">
                <div>
                  <p className="font-semibold">
                    {tLibrary('assets.selection.forceTitle')}
                  </p>
                  <p className="mt-1 text-slate-600 dark:text-slate-300">
                    {tLibrary('assets.selection.forceDescription', {
                      name: deleteModalState.forceTarget?.name || tLibrary('assets.selection.forceUnknown'),
                    })}
                  </p>
                </div>
                <div className="space-y-3">
                  {renderForceUsageList('streams', forceTargetUsage?.streams)}
                  {renderForceUsageList('collections', forceTargetUsage?.collections)}
                  {renderForceUsageList('playlists', forceTargetUsage?.playlists)}
                </div>
              </div>
            )}

            <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">
              {deleteModalAssets.map((asset) => {
                const usage = asset.usage
                const playlistsCount = usage?.playlists?.length ?? 0
                const collectionsCount = usage?.collections?.length ?? 0
                const streamsCount = usage?.streams?.length ?? 0
                const totalUsage = playlistsCount + collectionsCount + streamsCount
                const usageBadges = [
                  formatUsageLabel('streams', streamsCount),
                  formatUsageLabel('collections', collectionsCount),
                  formatUsageLabel('playlists', playlistsCount),
                ].filter(Boolean)

                return (
                  <div
                    key={`delete-${asset.id}`}
                    className={`rounded-lg border px-4 py-3 ${
                      deleteModalState.forceTarget?.assetId === asset.id
                        ? 'border-amber-400 bg-amber-50/60 dark:border-amber-400/60 dark:bg-amber-500/10'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="truncate text-sm font-medium text-slate-900 dark:text-white">
                        {asset.filename}
                      </h4>
                      {totalUsage > 0 && (
                        <Badge variant="warning">
                          {tLibrary('assets.usage.pill', { count: totalUsage })}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-300">
                      {usageBadges.length > 0 ? (
                        usageBadges.map((label, index) => (
                          <span
                            key={`${asset.id}-usage-${index}`}
                            className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800/60"
                          >
                            {label}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">
                          {tLibrary('assets.usage.none')}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" onClick={closeDeleteModal}>
                {tLibrary('assets.selection.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={handleConfirmDelete}
                isLoading={isDeletingSelection}
                disabled={deleteModalState.forceRequired}
              >
                {tLibrary('assets.selection.deleteConfirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {folderModalState && folderModalState.mode !== 'delete' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-md shadow-2xl">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {folderModalState.mode === 'create'
                      ? tFolders('modal.createTitle')
                      : tFolders('modal.renameTitle')}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {folderModalState.folder?.name || tFolders('all')}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={closeFolderModal}>
                  <X className="h-5 w-5" />
                  <span className="sr-only">{actionLabels('close')}</span>
                </Button>
              </div>

              <form onSubmit={handleFolderModalSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {tFolders('modal.nameLabel')}
                  </label>
                  <Input
                    value={folderNameInput}
                    onChange={(event) => setFolderNameInput(event.target.value)}
                    required
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={closeFolderModal}>
                    {actionLabels('cancel')}
                  </Button>
                  <Button type="submit" isLoading={isFolderSubmitting}>
                    {actionLabels('save')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {folderModalState && folderModalState.mode === 'delete' && folderModalState.folder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-md shadow-2xl">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {tFolders('modal.deleteTitle')}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {tFolders('modal.deleteMessage', { name: folderModalState.folder.name })}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={closeFolderModal}>
                  <X className="h-5 w-5" />
                  <span className="sr-only">{actionLabels('close')}</span>
                </Button>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={closeFolderModal}>
                  {actionLabels('cancel')}
                </Button>
                <Button
                  variant="danger"
                  onClick={handleFolderDelete}
                  isLoading={isFolderSubmitting}
                >
                  {tFolders('delete')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
