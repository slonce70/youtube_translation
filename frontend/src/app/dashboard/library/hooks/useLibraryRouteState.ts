'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { getAssetEmptyCopy, type AssetFilterValue } from '../empty-state-copy'

type UseLibraryRouteStateOptions = {
  tLibrary: (key: string) => string
}

export const useLibraryRouteState = ({ tLibrary }: UseLibraryRouteStateOptions) => {
  const searchParams = useSearchParams()
  const router = useRouter()

  const buildLibraryRoute = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const nextParams = new URLSearchParams(searchParams?.toString() ?? '')
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
    [searchParams],
  )

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

  const [activeTab, setActiveTab] = useState(searchParams?.get('tab') || 'assets')
  const [assetFilter, setAssetFilter] = useState<AssetFilterValue>(
    deriveAssetFilter(searchParams?.get('type') ?? null),
  )
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>(
    deriveFolderSelection(searchParams?.get('folder') ?? null),
  )

  useEffect(() => {
    const tab = searchParams?.get('tab')
    if (tab && (tab === 'assets' || tab === 'playlists')) {
      setActiveTab(tab)
    }
    setAssetFilter(deriveAssetFilter(searchParams?.get('type') ?? null))
    setSelectedFolderId(deriveFolderSelection(searchParams?.get('folder') ?? null))
  }, [deriveAssetFilter, deriveFolderSelection, searchParams])

  const assetEmptyCopy = getAssetEmptyCopy((key) => tLibrary(key), assetFilter)

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    router.push(buildLibraryRoute({ tab }), { scroll: false })
  }

  const handleAssetFilterChange = (filter: AssetFilterValue) => {
    if (assetFilter === filter) return
    setAssetFilter(filter)
    router.push(buildLibraryRoute({ type: filter === 'all' ? null : filter }), {
      scroll: false,
    })
  }

  return {
    activeTab,
    assetEmptyCopy,
    assetFilter,
    buildLibraryRoute,
    handleAssetFilterChange,
    handleTabChange,
    selectedFolderId,
    setSelectedFolderId,
  }
}
