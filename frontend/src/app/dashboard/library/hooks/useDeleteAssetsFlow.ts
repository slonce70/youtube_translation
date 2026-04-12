'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ApiError } from '@/lib/api'
import type { Asset, AssetUsageReference } from '@/lib/types'

type DeleteModalState = {
  open: boolean
  assetIds: string[]
  forceRequired: boolean
  forceTarget?: {
    assetId: string
    name?: string
    usage?: Asset['usage']
  }
}

type UseDeleteAssetsFlowOptions = {
  assetMap: Map<string, Asset>
  assetDeleteFailed: string
  assetDeleted: string
  assetForceToast: string
  collectionDeleted: string
  collectionDeleteBlocked: string
  collectionDeleteFailed: (message: string) => string
  confirmDeleteCollection: (name: string) => string
  confirmDeletePlaylist: (name: string) => string
  confirmDeleteStream: (name: string) => string
  forceUnknown: string
  genericError: (message: string) => string
  playlistDeleted: string
  playlistDeleteFailed: (message: string) => string
  streamDeleteFailed: (message: string) => string
  streamDeleted: string
  userId?: string
}

export const useDeleteAssetsFlow = ({
  assetMap,
  assetDeleteFailed,
  assetDeleted,
  assetForceToast,
  collectionDeleted,
  collectionDeleteBlocked,
  collectionDeleteFailed,
  confirmDeleteCollection,
  confirmDeletePlaylist,
  confirmDeleteStream,
  forceUnknown,
  genericError,
  playlistDeleted,
  playlistDeleteFailed,
  streamDeleteFailed,
  streamDeleted,
  userId,
}: UseDeleteAssetsFlowOptions) => {
  const queryClient = useQueryClient()
  const [deleteModalState, setDeleteModalState] = useState<DeleteModalState>({
    open: false,
    assetIds: [],
    forceRequired: false,
    forceTarget: undefined,
  })
  const [pendingDeletionIds, setPendingDeletionIds] = useState<Set<string>>(new Set())
  const [pendingUsageActionKeys, setPendingUsageActionKeys] = useState<Set<string>>(new Set())

  const resolveAssetsByIds = useCallback(
    (ids: string[]) =>
      ids
        .map((id) => assetMap.get(id))
        .filter((asset): asset is Asset => Boolean(asset)),
    [assetMap],
  )

  const openDeleteModal = (assetIds: string[]) => {
    if (!assetIds.length) return
    const candidateAssets = resolveAssetsByIds(assetIds)
    const firstUsed = candidateAssets.find((asset) => {
      const usage = asset.usage
      const playlists = usage?.playlists?.length ?? 0
      const collections = usage?.collections?.length ?? 0
      const streams = usage?.streams?.length ?? 0
      return playlists + collections + streams > 0
    })
    setDeleteModalState({
      open: true,
      assetIds,
      forceRequired: Boolean(firstUsed),
      forceTarget: firstUsed
        ? {
            assetId: firstUsed.id,
            name: firstUsed.filename,
            usage: firstUsed.usage,
          }
        : undefined,
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

  const markUsageActionPending = useCallback((key: string, pending: boolean) => {
    setPendingUsageActionKeys((prev) => {
      const next = new Set(prev)
      if (pending) {
        next.add(key)
      } else {
        next.delete(key)
      }
      return next
    })
  }, [])

  const pruneForceUsage = useCallback(
    (label: 'streams' | 'collections' | 'playlists', itemId: string) => {
      setDeleteModalState((prev) => {
        if (!prev.forceTarget?.usage) {
          return prev
        }

        const usage = prev.forceTarget.usage
        const nextUsage = {
          playlists:
            label === 'playlists'
              ? usage.playlists?.filter((item) => item.id !== itemId)
              : usage.playlists,
          collections:
            label === 'collections'
              ? usage.collections?.filter((item) => item.id !== itemId)
              : usage.collections,
          streams:
            label === 'streams'
              ? usage.streams?.filter((item) => item.id !== itemId)
              : usage.streams,
        }

        const hasRemaining =
          (nextUsage.playlists?.length ?? 0) +
            (nextUsage.collections?.length ?? 0) +
            (nextUsage.streams?.length ?? 0) >
          0

        return {
          ...prev,
          forceRequired: hasRemaining,
          forceTarget: prev.forceTarget
            ? {
                ...prev.forceTarget,
                usage: nextUsage,
              }
            : prev.forceTarget,
        }
      })
    },
    [],
  )

  const handleDeleteUsageStream = useCallback(
    async (streamRef: AssetUsageReference) => {
      const confirmDelete = confirm(
        confirmDeleteStream(streamRef.name || forceUnknown),
      )
      if (!confirmDelete) return

      const pendingKey = `stream:${streamRef.id}`
      markUsageActionPending(pendingKey, true)
      try {
        await api.streams.delete(streamRef.id)
        toast.success(streamDeleted)
        pruneForceUsage('streams', streamRef.id)
        queryClient.invalidateQueries({ queryKey: ['streams', userId] })
        queryClient.invalidateQueries({ queryKey: ['assets', userId] })
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : (error as Error)?.message ?? forceUnknown
        toast.error(streamDeleteFailed(message))
      } finally {
        markUsageActionPending(pendingKey, false)
      }
    },
    [
      confirmDeleteStream,
      forceUnknown,
      markUsageActionPending,
      pruneForceUsage,
      queryClient,
      streamDeleteFailed,
      streamDeleted,
      userId,
    ],
  )

  const handleDeleteUsageCollection = useCallback(
    async (collectionRef: AssetUsageReference) => {
      const confirmDelete = confirm(
        confirmDeleteCollection(collectionRef.name || forceUnknown),
      )
      if (!confirmDelete) return

      const pendingKey = `collection:${collectionRef.id}`
      markUsageActionPending(pendingKey, true)
      try {
        await api.mediaCollections.delete(collectionRef.id)
        toast.success(collectionDeleted)
        pruneForceUsage('collections', collectionRef.id)
        queryClient.invalidateQueries({ queryKey: ['media-collections', userId] })
        queryClient.invalidateQueries({ queryKey: ['assets', userId] })
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          toast.error(collectionDeleteBlocked)
        } else {
          const message =
            error instanceof ApiError
              ? error.message
              : (error as Error)?.message ?? forceUnknown
          toast.error(collectionDeleteFailed(message))
        }
      } finally {
        markUsageActionPending(pendingKey, false)
      }
    },
    [
      collectionDeleted,
      collectionDeleteBlocked,
      collectionDeleteFailed,
      confirmDeleteCollection,
      forceUnknown,
      markUsageActionPending,
      pruneForceUsage,
      queryClient,
      userId,
    ],
  )

  const handleDeleteUsagePlaylist = useCallback(
    async (playlistRef: AssetUsageReference) => {
      const confirmDelete = confirm(
        confirmDeletePlaylist(playlistRef.name || forceUnknown),
      )
      if (!confirmDelete) return

      const pendingKey = `playlist:${playlistRef.id}`
      markUsageActionPending(pendingKey, true)
      try {
        await api.playlists.delete(playlistRef.id)
        toast.success(playlistDeleted)
        pruneForceUsage('playlists', playlistRef.id)
        queryClient.invalidateQueries({ queryKey: ['playlists', userId] })
        queryClient.invalidateQueries({ queryKey: ['assets', userId] })
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : (error as Error)?.message ?? forceUnknown
        toast.error(playlistDeleteFailed(message))
      } finally {
        markUsageActionPending(pendingKey, false)
      }
    },
    [
      confirmDeletePlaylist,
      forceUnknown,
      markUsageActionPending,
      playlistDeleteFailed,
      playlistDeleted,
      pruneForceUsage,
      queryClient,
      userId,
    ],
  )

  const deleteModalAssets = useMemo(
    () => resolveAssetsByIds(deleteModalState.assetIds),
    [deleteModalState.assetIds, resolveAssetsByIds],
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
    pendingDeletionIds.has(id),
  )

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

  const deleteAssets = async (
    assetIds: string[],
    clearSelectedAssets: (assetIds: string[]) => void,
  ) => {
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
            toast.warning(assetForceToast)
            return
          }
          throw error
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['assets', userId] })
      toast.success(assetDeleted)
      clearSelectedAssets(assetIds)
      closeDeleteModal()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : assetDeleteFailed
      toast.error(genericError(message))
      closeDeleteModal()
    } finally {
      markAssetsAsDeleting(assetIds, false)
    }
  }

  return {
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
  }
}
