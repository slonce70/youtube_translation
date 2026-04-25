'use client'
// Sprint 7.3: full i18n migration to library.page.* keys lifted the eslint-disable.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactElement } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { 
  AlertCircle, Upload, ListVideo, Plus, CheckCircle, XCircle, Clock, 
  List, PlayCircle, CalendarClock, Edit, Trash2, ChevronDown, ChevronUp, Loader2, X,
  Folder, FolderPlus, CheckSquare, Square, MinusSquare, Search
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
  MediaFolder,
  Playlist,
  PlaylistCreatePayload,
  PlaylistItemInput,
  PlaylistUpdatePayload,
} from '@/lib/types'
import { AssetActionsMenu } from '@/components/AssetActionsMenu'
import {
  deriveAssetDisplayInfo,
  formatAssetWarningMessage,
  formatBitrateDisplay,
  formatFpsDisplay,
  formatSampleRateDisplay,
  type AssetDisplayInfo,
} from './asset-utils'
import { useLibraryRouteState } from './hooks/useLibraryRouteState'
import { useLibraryPageData } from './hooks/useLibraryPageData'
import { useAssetSelection } from './hooks/useAssetSelection'
import { usePlaylistManager } from './hooks/usePlaylistManager'
import { useFolderManager } from './hooks/useFolderManager'
import { useAssetActions } from './hooks/useAssetActions'
import { useDeleteAssetsFlow } from './hooks/useDeleteAssetsFlow'
import { useLibraryUploads } from './hooks/useLibraryUploads'
import { applyAssetView, type AssetSortValue } from './asset-view'
import { useDashboardContext } from '../dashboard-context'
import { Breadcrumbs } from '@/components/library/Breadcrumbs'
import { FolderCard } from '@/components/library/FolderCard'
import { AssetCard } from '@/components/library/AssetCard'
import { FolderSelectionTree } from './components/FolderSelectionTree'
import { ForceUsageList } from './components/ForceUsageList'
import { DeleteAssetsModal } from './components/DeleteAssetsModal'
import { FolderModal } from './components/FolderModal'
import { MoveAssetsModal } from './components/MoveAssetsModal'
import { RenameAssetModal } from './components/RenameAssetModal'
import { AssetValidationModal } from './components/AssetValidationModal'
import type { AssetFilterValue } from './empty-state-copy'

type PlaylistFormState = PlaylistCreatePayload & { description: string }
const LazyUploadModal = dynamic(
  () => import('@/components/upload/UploadModal').then((module) => module.UploadModal),
  { ssr: false },
)

export default function LibraryPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user, quota } = useDashboardContext()
  const libraryToasts = useTranslations('library.toasts')
  const tLibrary = useTranslations('library.page')
  const tFolders = useTranslations('library.folders')
  const tUploadModal = useTranslations('library.uploadModal')
  const tAssetWarnings = useTranslations('library.page.assets.warnings')
  const tStreamingStatus = useTranslations('streaming.status')
  const actionLabels = useTranslations('common.actions')
  const {
    activeTab,
    assetEmptyCopy,
    assetFilter,
    buildLibraryRoute,
    handleAssetFilterChange,
    handleTabChange,
    selectedFolderId,
    setSelectedFolderId,
  } = useLibraryRouteState({ tLibrary })
  const {
    clearUploadStatusOverrides,
    closeUploadModal,
    isProcessingUpload,
    isUploadOpen,
    openUploadModal,
    uppy,
    uploadStatusEntries,
    uploadStatusOverrides,
  } = useLibraryUploads({
    libraryToasts,
    userId: user?.id,
  })

  // Assets state
  const [assetSearchQuery, setAssetSearchQuery] = useState('')
  const [assetSort, setAssetSort] = useState<AssetSortValue>('newest')
  const [assetDensity, setAssetDensity] = useState<'compact' | 'comfortable'>('compact')
  const [inUseOnly, setInUseOnly] = useState(false)
  const [warningsOnly, setWarningsOnly] = useState(false)
  const [moveModalState, setMoveModalState] = useState<{ open: boolean; assetIds: string[] }>({
    open: false,
    assetIds: [],
  })
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>('')
  const [draggedAssetIds, setDraggedAssetIds] = useState<string[] | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | 'all' | null>(null)
  const [isGlobalDragOver, setIsGlobalDragOver] = useState(false)

  useEffect(() => {
    const density = window.localStorage.getItem('yt.library.assetDensity')
    if (density === 'compact' || density === 'comfortable') {
      setAssetDensity(density)
    }

    const sort = window.localStorage.getItem('yt.library.assetSort')
    if (
      sort === 'newest' ||
      sort === 'oldest' ||
      sort === 'nameAsc' ||
      sort === 'nameDesc' ||
      sort === 'sizeDesc' ||
      sort === 'sizeAsc'
    ) {
      setAssetSort(sort)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('yt.library.assetDensity', assetDensity)
  }, [assetDensity])

  useEffect(() => {
    window.localStorage.setItem('yt.library.assetSort', assetSort)
  }, [assetSort])

  const handleFolderSelect = (folderId: string | 'all') => {
    setSelectedFolderId(folderId)
    setSelectedAssets(new Set())
    router.push(buildLibraryRoute({ folder: folderId === 'all' ? null : folderId }), {
      scroll: false,
    })
  }

  const {
    assetMap,
    assets,
    currentFolders,
    displayedAssets,
    folderChildren,
    folderItemCounts,
    folders,
    isFoldersError,
    isLoadingAssets,
    isLoadingFolders,
    isLoadingPlaylists,
    librarySummary,
    playlists,
    rootFolderId,
    totalAssets,
    totalPlaylists,
    visibleAssets,
  } = useLibraryPageData({
    assetFilter,
    assetSearchQuery,
    assetSort,
    inUseOnly,
    selectedFolderId,
    userId: user?.id,
    warningsOnly,
  })
  const {
    addAssetToPlaylist,
    createPlaylistMutation,
    deletePlaylistMutation,
    editingPlaylistId,
    handleDeletePlaylist,
    handleEditPlaylist,
    handleSubmitPlaylist,
    playlistForm,
    removePlaylistItem,
    resetPlaylistForm,
    setPlaylistForm,
    setShowCreatePlaylist,
    showCreatePlaylist,
    updatePlaylistMutation,
  } = usePlaylistManager({
    confirmDeleteMessage: tLibrary('playlists.messages.confirmDelete'),
    genericError: (message) =>
      libraryToasts('generic.errorWithMessage', { message }),
    playlistCreatedMessage: libraryToasts('playlist.created'),
    playlistDeletedMessage: libraryToasts('playlist.deleted'),
    playlistUpdatedMessage: libraryToasts('playlist.updated'),
    userId: user?.id,
  })
  const {
    closeFolderModal,
    createFolderMutation,
    deleteFolderMutation,
    folderModalState,
    folderNameInput,
    handleFolderDelete,
    handleFolderModalSubmit,
    openCreateFolderModal,
    openDeleteFolderModal,
    openRenameFolderModal,
    setFolderNameInput,
    updateFolderMutation,
  } = useFolderManager({
    emptyNameMessage: libraryToasts('asset.renameEmpty'),
    genericError: (message) =>
      libraryToasts('generic.errorWithMessage', { message }),
    selectedFolderId,
    setSelectedFolderId,
    userId: user?.id,
    folderCreatedMessage: libraryToasts('folder.created'),
    folderDeletedMessage: libraryToasts('folder.deleted'),
    folderUpdatedMessage: libraryToasts('folder.updated'),
  })
  const {
    closeDeleteModal,
    deleteAssets,
    deleteModalAssets,
    deleteModalState,
    deleteSelectionHasUsage,
    forceTargetUsage,
    handleDeleteUsageCollection,
    handleDeleteUsagePlaylist,
    handleDeleteUsageStream,
    isDeletingSelection,
    openDeleteModal,
    pendingDeletionIds,
    pendingUsageActionKeys,
    resolveAssetsByIds,
    setDeleteModalState,
  } = useDeleteAssetsFlow({
    assetMap,
    assetDeleteFailed: libraryToasts('asset.deleteFailed'),
    assetDeleted: libraryToasts('asset.deleted'),
    assetForceToast: libraryToasts('asset.forceToast'),
    collectionDeleted: libraryToasts('references.collectionDeleted'),
    collectionDeleteBlocked: libraryToasts('references.collectionDeleteBlocked'),
    collectionDeleteFailed: (message) =>
      libraryToasts('references.collectionDeleteFailed', { message }),
    confirmDeleteCollection: (name) =>
      tLibrary('assets.selection.confirmDeleteCollection', { name }),
    confirmDeletePlaylist: (name) =>
      tLibrary('playlists.messages.confirmDelete', { name }),
    confirmDeleteStream: (name) =>
      tLibrary('assets.selection.confirmDeleteStream', { name }),
    forceUnknown: tLibrary('assets.selection.forceUnknown'),
    genericError: (message) =>
      libraryToasts('generic.errorWithMessage', { message }),
    playlistDeleted: libraryToasts('playlist.deleted'),
    playlistDeleteFailed: (message) =>
      libraryToasts('generic.errorWithMessage', { message }),
    streamDeleteFailed: (message) =>
      libraryToasts('references.streamDeleteFailed', { message }),
    streamDeleted: libraryToasts('references.streamDeleted'),
    userId: user?.id,
  })

  const hasViewFilters = Boolean(assetSearchQuery.trim() || inUseOnly || warningsOnly)
  const {
    allDisplayedSelected,
    clearAssetSelection,
    hasSelection,
    isPartiallySelected,
    selectAllDisplayedAssets,
    selectedAssetCount,
    selectedAssets,
    selectedAssetsArray,
    selectedDisplayedCount,
    setSelectedAssets,
    toggleAssetSelection,
  } = useAssetSelection({
    displayedAssets,
    hasViewFilters,
    visibleAssets,
  })
  const {
    assetBeingRenamed,
    checkModalAsset,
    checkModalInfo,
    checkingAssetId,
    closeCheckModal,
    closeRenameModal,
    downloadAssetId,
    downloadLinkMutation,
    expandedAssets,
    handleCheckAsset,
    handleDownloadAsset,
    handleOptimizeAsset,
    handleRenameAsset,
    isCheckModalLoading,
    optimizingAssetId,
    optimizeAssetMutation,
    renameValue,
    revalidateAssetMutation,
    setRenameValue,
    submitRename,
    toggleAssetDetails,
    updateAssetMutation,
  } = useAssetActions({
    assetDownloadLabel: (name) => libraryToasts('asset.download', { name }),
    assetDownloadLinkFailed: libraryToasts('asset.downloadLinkFailed'),
    assetOptimizeFailed: libraryToasts('asset.optimizeFailed'),
    assetOptimizeQueued: (name) => libraryToasts('asset.optimizeQueued', { name }),
    assetOptimizeReady: (name) => libraryToasts('asset.optimizeReady', { name }),
    assetRenameEmpty: libraryToasts('asset.renameEmpty'),
    assetUpdateFailed: libraryToasts('asset.updateFailed'),
    assetUpdated: libraryToasts('asset.updated'),
    assetValidateFailed: libraryToasts('asset.validateFailed'),
    assetValidationRefreshed: libraryToasts('asset.validationRefreshed'),
    genericError: (message) =>
      libraryToasts('generic.errorWithMessage', { message }),
    userId: user?.id,
  })

  // Mutations
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

  const formatUsageLabel = useCallback(
    (type: 'streams' | 'collections' | 'playlists', count: number) => {
      if (!count) return null
      return tLibrary(`assets.usage.${type}` as any, { count })
    },
    [tLibrary]
  )

  const formatCollectionContext = useCallback(
    (context?: string | null) => {
      if (!context) return null
      if (context === 'video_background') {
        return tLibrary('assets.selection.collectionContext.video_background')
      }
      if (context === 'audio_playlist') {
        return tLibrary('assets.selection.collectionContext.audio_playlist')
      }
      return null
    },
    [tLibrary],
  )

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

  const isFolderSubmitting =
    createFolderMutation.isPending ||
    updateFolderMutation.isPending ||
    deleteFolderMutation.isPending

  // Handlers
  const handleDeleteAsset = (assetId: string) => {
    openDeleteModal([assetId])
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
    await deleteAssets(ids, (deletedIds) => {
      setSelectedAssets((prev) => {
        const next = new Set(prev)
        deletedIds.forEach((id) => next.delete(id))
        return next
      })
    })
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

  const handleNotImplemented = (feature: string) => {
    toast.info(libraryToasts('generic.comingSoon', { feature }))
  }

  const handleGlobalDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsGlobalDragOver(false)
    const files = Array.from(event.dataTransfer.files || [])
    if (!files.length) return
    openUploadModal()
    uppy.addFiles(
      files.map((file) => ({
        name: file.name,
        type: file.type,
        data: file,
        source: 'drag-drop',
      })),
    )
  }

  const availableAssets = useMemo<Asset[]>(() => {
    if (!assets) return [] as Asset[]
    return assets
      .filter((asset) => asset.compatible_for_copy)
      .filter((asset) => !playlistForm.items.some((item) => item.asset_id === asset.id))
  }, [assets, playlistForm.items])

  if (!user) {
    return <LoadingState text={tLibrary('loading')} />
  }

  return (
    <div
      className="page-shell"
      onDragEnter={() => setIsGlobalDragOver(true)}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsGlobalDragOver(false)
      }}
      onDrop={handleGlobalDrop}
    >
      <div className="page-header">
        <div>
          <div className="page-title">{tLibrary('header.title')}</div>
          <div className="page-sub">{tLibrary('header.usedFromLimit', { used: formatBytes(quota?.storage.used_bytes ?? 0), limit: quota?.storage.limit_gb ?? 0 })}</div>
        </div>
        <div className="page-actions">
          <Button variant="outline" size="sm" onClick={() => setAssetDensity(assetDensity === 'compact' ? 'comfortable' : 'compact')}>{'⊞ '}{assetDensity === 'compact' ? tLibrary('density.grid') : tLibrary('density.list')}</Button>
          <Button onClick={openUploadModal} aria-label={tLibrary('uploadAria')} title={tLibrary('uploadAria')}>{tLibrary('uploadButton')}</Button>
        </div>
      </div>

      {isGlobalDragOver ? (
        <div className="drop-overlay">
          <div className="empty-state" style={{ padding: 0 }}>
            <div className="empty-icon" aria-hidden="true">{'⬆️'}</div>
            <div className="empty-title">{tLibrary('dropZone.title')}</div>
            <div className="empty-sub">{tLibrary('dropZone.description')}</div>
          </div>
        </div>
      ) : null}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="library-tabs-list w-full max-w-md">
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
            {(selectedFolderId !== 'all' || currentFolders.length > 0) ? (
              <Breadcrumbs
                currentFolderId={selectedFolderId}
                folders={folders}
                onNavigate={handleFolderSelect}
                onDrop={handleFolderDrop}
              />
            ) : null}

            <div className="toolbar-panel library-toolbar-panel">
              <div className="toolbar-row library-toolbar-row">
                <div className="relative" style={{ flex: 1, maxWidth: 380 }}>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={assetSearchQuery}
                    onChange={(event) => setAssetSearchQuery(event.target.value)}
                    placeholder={tLibrary('assets.search.placeholder')}
                    aria-label={tLibrary('assets.search.placeholder')}
                    className="pr-10"
                    style={{ paddingLeft: 40, paddingRight: 40 }}
                  />
                  {assetSearchQuery.trim() ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setAssetSearchQuery('')}
                      aria-label={tLibrary('assets.search.clear')}
                      title={tLibrary('assets.search.clear')}
                      className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
                <div className="toolbar-row library-filter-row">
                  <button type="button" className={assetFilter === 'all' ? 'filter-pill active' : 'filter-pill'} onClick={() => handleAssetFilterChange('all')}>{tLibrary('filtersExtra.all')}</button>
                  <button type="button" className={assetFilter === 'video' ? 'filter-pill active' : 'filter-pill'} onClick={() => handleAssetFilterChange('video')}>{tLibrary('filtersExtra.video')}</button>
                  <button type="button" className={assetFilter === 'audio' ? 'filter-pill active' : 'filter-pill'} onClick={() => handleAssetFilterChange('audio')}>{tLibrary('filtersExtra.audio')}</button>
                  <button type="button" className={'filter-pill'} onClick={() => handleNotImplemented(tLibrary('notImplemented.archives'))}>{tLibrary('filtersExtra.archives')}</button>
                </div>
                <select
                  value={assetSort}
                  onChange={(event) => setAssetSort(event.target.value as AssetSortValue)}
                  aria-label={tLibrary('assets.sort.ariaLabel')}
                  className="input"
                  style={{ width: 'auto', minWidth: 180 }}
                >
                  <option value="newest">{tLibrary('sortShort.newest')}</option>
                  <option value="oldest">{tLibrary('sortShort.oldest')}</option>
                  <option value="nameAsc">{tLibrary('sortShort.nameAsc')}</option>
                  <option value="sizeDesc">{tLibrary('sortShort.sizeDesc')}</option>
                </select>
              </div>
            </div>

            {displayedAssets.length > 0 && (
                <div className="selection-bar text-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        if (allDisplayedSelected) {
                          clearAssetSelection()
                        } else {
                          selectAllDisplayedAssets()
                        }
                      }}
                      className="inline-flex items-center gap-2 text-left font-medium text-slate-200 transition-colors hover:text-white"
                    >
                      {allDisplayedSelected ? (
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
                        <span className="font-semibold text-white">
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

                {/* Render assets (grid for compact view) */}
                {displayedAssets.length > 0 ? (
                  <div
                    className={assetDensity === 'compact'
                      ? 'grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
                      : 'flex flex-col gap-3'}
                  >
                    {displayedAssets.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        density={assetDensity}
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
                        onOptimize={() => handleOptimizeAsset(asset)}
                        onDragStart={(event) => handleAssetDragStart(event, asset.id)}
                        onDragEnd={handleAssetDragEnd}
                        isDeleting={pendingDeletionIds.has(asset.id)}
                        isChecking={checkingAssetId === asset.id}
                        isGeneratingDownload={downloadAssetId === asset.id && downloadLinkMutation.isPending}
                        formatWarningMessage={(warning) =>
                          formatAssetWarningMessage(tAssetWarnings, warning)
                        }
                        formatUsageLabel={formatUsageLabel}
                        t={{
                          filters: { audio: tLibrary('assets.filters.audio') },
                          badges: {
                            ready: tLibrary('assets.badges.ready'),
                            needsEncoding: tLibrary('assets.badges.needsEncoding'),
                            bitrateOk: tLibrary('assets.badges.bitrateOk'),
                            bitrateCheck: tLibrary('assets.badges.bitrateCheck'),
                            copyMode: tLibrary('assets.badges.copyMode'),
                            optimizeQueued: tLibrary('assets.badges.optimizeQueued'),
                            optimizeFailed: tLibrary('assets.badges.optimizeFailed'),
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
                          iconActions: {
                            download: tLibrary('assets.iconActions.download'),
                            validate: tLibrary('assets.iconActions.validate'),
                            move: tLibrary('assets.iconActions.move'),
                            delete: tLibrary('assets.iconActions.delete'),
                          },
                        }}
                      />
                    ))}
                  </div>
                ) : null}

                {hasViewFilters && visibleAssets.length > 0 && displayedAssets.length === 0 && (
                  <Card className="py-12">
                    <CardContent className="text-center">
                      <Search className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-600 mb-3" />
                      <p className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                        {assetSearchQuery.trim()
                          ? tLibrary('assets.search.noResultsTitle')
                          : tLibrary('assets.filteredEmpty.title')}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {assetSearchQuery.trim()
                          ? tLibrary('assets.search.noResultsDescription', { query: assetSearchQuery.trim() })
                          : tLibrary('assets.filteredEmpty.description')}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Empty state - shown when no folders and no assets */}
                {!currentFolders.length && visibleAssets.length === 0 && (
                  <button type="button" onClick={openUploadModal} className="library-upload-tile" style={{ margin: 0 }}>
                    <div className="empty-state" style={{ padding: 0 }}>
                      <div className="empty-icon" aria-hidden="true">{'⬆'}</div>
                      <div className="empty-title">{tLibrary('dropEmpty.title')}</div>
                      <div className="empty-sub">{tLibrary('dropEmpty.description')}</div>
                    </div>
                  </button>
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
                                  onClick={() => removePlaylistItem(index)}
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

      {uploadStatusEntries.length > 0 || isProcessingUpload ? (
        <div className="floating-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>{tLibrary('uploadStatus.title')}</strong>
            <button type="button" aria-label="close" style={{ marginLeft: 'auto', color: 'var(--txt-3)', fontSize: 18 }} onClick={clearUploadStatusOverrides}>{'×'}</button>
          </div>
          <div className="summary-list">
            {uploadStatusEntries.map(([uploadId, status]) => (
              <div key={uploadId} className="stream-row" style={{ alignItems: 'center' }}>
                <div className="stream-thumb" aria-hidden="true">{'⬆️'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{uploadId}</div>
                  <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                    {status.status === 'processing'
                      ? tLibrary('uploadStatus.processing')
                      : status.status === 'complete'
                        ? tLibrary('uploadStatus.complete')
                        : status.error || tLibrary('uploadStatus.error')}
                  </div>
                </div>
              </div>
            ))}
            {isProcessingUpload && uploadStatusEntries.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>{tLibrary('uploadStatus.preparing')}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Upload Modal */}
      {isUploadOpen ? (
        <LazyUploadModal
          isOpen={isUploadOpen}
          onClose={closeUploadModal}
          uppy={uppy}
          isProcessingUpload={isProcessingUpload}
          uploadStatusOverrides={uploadStatusOverrides}
          folders={folders}
        />
      ) : null}

      <MoveAssetsModal
        assets={moveModalAssets}
        closeLabel={tLibrary('assets.selection.cancel')}
        description={tLibrary('assets.selection.bulkMoveDescription')}
        folderChildren={folderChildren}
        isLoading={moveAssetsMutation.isPending}
        isOpen={moveModalState.open}
        moveConfirmLabel={tLibrary('assets.selection.moveConfirm')}
        onClose={closeMoveModal}
        onConfirm={handleConfirmMove}
        onSelectFolder={setMoveTargetFolderId}
        rootFolderId={rootFolderId}
        rootOptionLabel={tUploadModal('folder.rootOption')}
        selectedFolderId={moveTargetFolderId}
        selectionCountLabel={tLibrary('assets.selection.count', { count: moveModalAssets.length })}
        targetLabel={tLibrary('assets.selection.targetLabel')}
        title={tLibrary('assets.selection.bulkMoveTitle')}
        unknownValueLabel={tAssetWarnings('unknownValue')}
      />

      <DeleteAssetsModal
        closeLabel={tLibrary('assets.selection.cancel')}
        collectionDeleteLabel={tLibrary('assets.selection.actions.deleteCollection')}
        playlistDeleteLabel={tLibrary('playlists.actions.delete')}
        collectionsHint={tLibrary('assets.selection.collectionsHint')}
        deleteConfirmLabel={tLibrary('assets.selection.deleteConfirm')}
        deleteDescription={tLibrary('assets.selection.deleteDescription')}
        deleteUsageWarning={tLibrary('assets.selection.deleteUsageWarning')}
        deleteModalAssets={deleteModalAssets}
        deleteSelectionHasUsage={deleteSelectionHasUsage}
        deleteStreamLabel={tLibrary('assets.selection.actions.deleteStream')}
        forceDescription={tLibrary('assets.selection.forceDescription', {
          name: deleteModalState.forceTarget?.name || tLibrary('assets.selection.forceUnknown'),
        })}
        forceTargetUsage={forceTargetUsage}
        forceTitle={tLibrary('assets.selection.forceTitle')}
        forceUnknownLabel={tLibrary('assets.selection.forceUnknown')}
        formatCollectionContext={formatCollectionContext}
        formatStatus={(status) => {
          const normalizedStatus = status ?? ''
          const knownStatuses = new Set(['running', 'stopped', 'starting', 'stopping', 'error', 'scheduled'])
          return knownStatuses.has(normalizedStatus)
            ? tStreamingStatus(normalizedStatus)
            : normalizedStatus
        }}
        formatUsageLabel={formatUsageLabel}
        isDeletingSelection={isDeletingSelection}
        onClose={closeDeleteModal}
        onConfirmDelete={handleConfirmDelete}
        onDeleteCollection={handleDeleteUsageCollection}
        onDeletePlaylist={handleDeleteUsagePlaylist}
        onDeleteStream={handleDeleteUsageStream}
        open={deleteModalState.open}
        pendingUsageActionKeys={pendingUsageActionKeys}
        selectionForceUsageCollectionsLabel={tLibrary('assets.selection.forceUsage.collections')}
        selectionForceUsagePlaylistsLabel={tLibrary('assets.selection.forceUsage.playlists')}
        selectionForceUsageStreamsLabel={tLibrary('assets.selection.forceUsage.streams')}
        selectionUsageNoneLabel={tLibrary('assets.usage.none')}
        selectionUsagePillLabel={(count) => tLibrary('assets.usage.pill', { count })}
        state={deleteModalState}
        deleteTitle={tLibrary('assets.selection.deleteTitle')}
      />

      <FolderModal
        closeLabel={actionLabels('cancel')}
        deleteLabel={tFolders('delete')}
        deleteMessage={tFolders('modal.deleteMessage', {
          name: folderModalState?.folder?.name || tFolders('all'),
        })}
        folderNameInput={folderNameInput}
        isLoading={isFolderSubmitting}
        modeState={folderModalState}
        nameLabel={tFolders('modal.nameLabel')}
        onClose={closeFolderModal}
        onDelete={handleFolderDelete}
        onNameChange={setFolderNameInput}
        onSubmit={handleFolderModalSubmit}
        saveLabel={actionLabels('save')}
        selectedFolderName={folderModalState?.folder?.name || tFolders('all')}
        titleCreate={tFolders('modal.createTitle')}
        titleDelete={tFolders('modal.deleteTitle')}
        titleRename={tFolders('modal.renameTitle')}
      />

      <RenameAssetModal
        asset={assetBeingRenamed}
        cancelLabel={actionLabels('cancel')}
        closeLabel={actionLabels('close')}
        description={tLibrary('rename.description')}
        inputLabel={tLibrary('rename.label')}
        isLoading={updateAssetMutation.isPending}
        onClose={closeRenameModal}
        onRenameValueChange={setRenameValue}
        onSubmit={(event) => {
          event.preventDefault()
          submitRename()
        }}
        renameValue={renameValue}
        saveLabel={tLibrary('rename.save')}
        title={tLibrary('rename.title')}
      />

      <AssetValidationModal
        asset={checkModalAsset}
        closeLabel={actionLabels('close')}
        incompatibleSummary={tLibrary('assets.messages.incompatibleSummary')}
        info={checkModalInfo}
        isLoading={isCheckModalLoading}
        metadataAudioLabel={tLibrary('assets.metadata.audio')}
        metadataChannelsLabel={(count) =>
          tLibrary('assets.metadata.channels', { count })
        }
        metadataVideoLabel={tLibrary('assets.metadata.video')}
        onClose={closeCheckModal}
        readyLabel={tLibrary('assets.badges.ready')}
        recommendationsLabel={(input) =>
          tLibrary('assets.recommendations', input)
        }
        title={tLibrary('validation.title')}
        unavailableLabel={tLibrary('validation.unavailable')}
        validationCloseLabel={tLibrary('validation.close')}
        validationDescription={(filename) =>
          tLibrary('validation.description', { filename })
        }
        validationLoading={tLibrary('validation.loading')}
        warningBitrateCheckLabel={tLibrary('assets.badges.bitrateCheck')}
        warningBitrateOkLabel={tLibrary('assets.badges.bitrateOk')}
        warningNeedsEncodingLabel={tLibrary('assets.badges.needsEncoding')}
        tAssetWarnings={tAssetWarnings}
      />
    </div>
  )
}
