'use client'

import { useEffect, useMemo, useState } from 'react'

import type { Asset } from '@/lib/types'

type UseAssetSelectionOptions = {
  displayedAssets: Asset[]
  hasViewFilters: boolean
  visibleAssets: Asset[]
}

export const useAssetSelection = ({
  displayedAssets,
  hasViewFilters,
  visibleAssets,
}: UseAssetSelectionOptions) => {
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!visibleAssets.length) {
      setSelectedAssets((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }

    setSelectedAssets((prev) => {
      if (prev.size === 0) return prev
      const allowedIds = new Set(visibleAssets.map((asset) => asset.id))
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
  }, [visibleAssets])

  useEffect(() => {
    if (!hasViewFilters) return
    setSelectedAssets((prev) => {
      if (prev.size === 0) return prev
      const allowedIds = new Set(displayedAssets.map((asset) => asset.id))
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
  }, [displayedAssets, hasViewFilters])

  const selectedAssetCount = selectedAssets.size
  const hasSelection = selectedAssetCount > 0
  const selectedAssetsArray = useMemo(
    () => Array.from(selectedAssets),
    [selectedAssets],
  )
  const selectedDisplayedCount = useMemo(() => {
    if (displayedAssets.length === 0) return 0
    return displayedAssets.reduce(
      (count, asset) => (selectedAssets.has(asset.id) ? count + 1 : count),
      0,
    )
  }, [displayedAssets, selectedAssets])
  const allDisplayedSelected = Boolean(
    displayedAssets.length > 0 && selectedDisplayedCount === displayedAssets.length,
  )
  const isPartiallySelected = Boolean(
    selectedDisplayedCount > 0 && !allDisplayedSelected,
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

  const selectAllDisplayedAssets = () => {
    if (displayedAssets.length === 0) {
      setSelectedAssets(new Set())
      return
    }
    setSelectedAssets(new Set(displayedAssets.map((asset) => asset.id)))
  }

  const clearAssetSelection = () => {
    setSelectedAssets(new Set())
  }

  return {
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
  }
}
