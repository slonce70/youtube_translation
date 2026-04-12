'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import type { Asset } from '@/lib/types'

import { deriveAssetDisplayInfo, type AssetDisplayInfo } from '../asset-utils'

type UseAssetActionsOptions = {
  assetDownloadLabel: (name: string) => string
  assetDownloadLinkFailed: string
  assetOptimizeFailed: string
  assetOptimizeQueued: (name: string) => string
  assetOptimizeReady: (name: string) => string
  assetRenameEmpty: string
  assetUpdateFailed: string
  assetUpdated: string
  assetValidateFailed: string
  assetValidationRefreshed: string
  genericError: (message: string) => string
  userId?: string
}

export const useAssetActions = ({
  assetDownloadLabel,
  assetDownloadLinkFailed,
  assetOptimizeFailed,
  assetOptimizeQueued,
  assetOptimizeReady,
  assetRenameEmpty,
  assetUpdateFailed,
  assetUpdated,
  assetValidateFailed,
  assetValidationRefreshed,
  genericError,
  userId,
}: UseAssetActionsOptions) => {
  const queryClient = useQueryClient()
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set())
  const [assetBeingRenamed, setAssetBeingRenamed] = useState<Asset | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [checkingAssetId, setCheckingAssetId] = useState<string | null>(null)
  const [optimizingAssetId, setOptimizingAssetId] = useState<string | null>(null)
  const [downloadAssetId, setDownloadAssetId] = useState<string | null>(null)
  const [checkModalAsset, setCheckModalAsset] = useState<Asset | null>(null)
  const [checkModalInfo, setCheckModalInfo] = useState<AssetDisplayInfo | null>(null)
  const [isCheckModalLoading, setIsCheckModalLoading] = useState(false)

  const revalidateAssetMutation = useMutation({
    mutationFn: (assetId: string) => api.assets.revalidate(assetId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assets', userId] })
    },
    onError: (error: Error) => {
      toast.error(genericError(error.message))
    },
  })

  const updateAssetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { filename?: string } }) =>
      api.assets.update(id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assets', userId] })
      toast.success(assetUpdated)
    },
    onError: (error: Error) => {
      toast.error(genericError(error.message))
    },
  })

  const optimizeAssetMutation = useMutation({
    mutationFn: (assetId: string) => api.assets.optimize(assetId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['assets', userId] })
    },
    onError: (error: Error) => {
      toast.error(genericError(error.message))
    },
  })

  const downloadLinkMutation = useMutation({
    mutationFn: (assetId: string) => api.assets.createDownloadLink(assetId),
    onError: (error: Error) => {
      toast.error(genericError(error.message))
    },
  })

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
      toast.error(assetRenameEmpty)
      return
    }
    try {
      await updateAssetMutation.mutateAsync({
        id: assetBeingRenamed.id,
        data: { filename: trimmed },
      })
      closeRenameModal()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : assetUpdateFailed
      toast.error(genericError(message))
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
        toast.success(assetValidationRefreshed)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : assetValidateFailed
      toast.error(genericError(message))
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
      toast.info(assetDownloadLabel(asset.filename))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : assetDownloadLinkFailed
      toast.error(genericError(message))
    } finally {
      setDownloadAssetId(null)
    }
  }

  const handleOptimizeAsset = async (asset: Asset) => {
    if (optimizingAssetId === asset.id) {
      return
    }
    setOptimizingAssetId(asset.id)
    try {
      const updated = await optimizeAssetMutation.mutateAsync(asset.id)
      if (checkModalAsset?.id === updated.id) {
        setCheckModalAsset(updated)
        setCheckModalInfo(deriveAssetDisplayInfo(updated))
      }

      const strategy =
        updated.optimization.strategy ?? updated.optimization.recommended_strategy
      const status = updated.optimization.status
      if (status === 'ready' && strategy === 'copy') {
        toast.success(assetOptimizeReady(updated.filename))
      } else if (status === 'queued') {
        toast.success(assetOptimizeQueued(updated.filename))
      } else {
        toast.success(assetUpdated)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : assetOptimizeFailed
      toast.error(genericError(message))
    } finally {
      setOptimizingAssetId(null)
    }
  }

  return {
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
    optimizeAssetMutation,
    optimizingAssetId,
    renameValue,
    revalidateAssetMutation,
    setRenameValue,
    submitRename,
    toggleAssetDetails,
    updateAssetMutation,
  }
}
