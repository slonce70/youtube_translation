'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { Asset, MediaFolder, Playlist } from '@/lib/types'

import { applyAssetView, type AssetSortValue } from '../asset-view'
import { deriveAssetDisplayInfo } from '../asset-utils'
import type { AssetFilterValue } from '../empty-state-copy'

type UseLibraryPageDataOptions = {
  assetFilter: AssetFilterValue
  assetSearchQuery: string
  assetSort: AssetSortValue
  inUseOnly: boolean
  selectedFolderId: string | 'all'
  userId?: string
  warningsOnly: boolean
}

export const useLibraryPageData = ({
  assetFilter,
  assetSearchQuery,
  assetSort,
  inUseOnly,
  selectedFolderId,
  userId,
  warningsOnly,
}: UseLibraryPageDataOptions) => {
  const { data: assets, isLoading: isLoadingAssets } = useQuery<Asset[]>({
    queryKey: ['assets', userId, assetFilter, selectedFolderId],
    queryFn: () =>
      api.assets.list(
        assetFilter === 'all'
          ? selectedFolderId === 'all'
            ? undefined
            : { folder_id: selectedFolderId }
          : {
              asset_type: assetFilter,
              folder_id: selectedFolderId === 'all' ? undefined : selectedFolderId,
            },
      ),
    enabled: !!userId,
  })

  const {
    data: folders,
    isLoading: isLoadingFolders,
    isError: isFoldersError,
  } = useQuery<MediaFolder[]>({
    queryKey: ['media-folders', userId],
    queryFn: () => api.mediaFolders.list(),
    enabled: !!userId,
  })

  const { data: playlists, isLoading: isLoadingPlaylists } = useQuery<Playlist[]>({
    queryKey: ['playlists', userId],
    queryFn: () => api.playlists.list(),
    enabled: !!userId,
  })

  const rootFolderId = useMemo(() => {
    if (!folders || folders.length === 0) return null
    const root = folders.find((folder) => folder.is_root)
    return root ? root.id : null
  }, [folders])

  const visibleAssets = useMemo(() => {
    if (!assets) return [] as Asset[]
    return assets
  }, [assets])

  const displayedAssets = useMemo(
    () =>
      applyAssetView(visibleAssets, {
        query: assetSearchQuery,
        sort: assetSort,
        inUseOnly,
        warningsOnly,
      }),
    [assetSearchQuery, assetSort, inUseOnly, visibleAssets, warningsOnly],
  )

  const assetMap = useMemo(() => {
    if (!assets) {
      return new Map<string, Asset>()
    }
    return new Map(assets.map((asset) => [asset.id, asset]))
  }, [assets])

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

  const currentFolders = useMemo(() => {
    if (!folders || folders.length === 0) return []

    const effectiveParentId =
      selectedFolderId === 'all' ? rootFolderId ?? null : selectedFolderId

    return folders
      .filter((folder) => {
        if (folder.is_root) return false
        if (effectiveParentId === null) {
          return folder.parent_id === null
        }
        return folder.parent_id === effectiveParentId
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [folders, rootFolderId, selectedFolderId])

  const folderItemCounts = useMemo(() => {
    if (!folders || !assets) return new Map<string, number>()

    const counts = new Map<string, number>()

    const getDescendantIds = (folderId: string): string[] => {
      const descendants: string[] = [folderId]
      const children = folders.filter((folder) => folder.parent_id === folderId)
      children.forEach((child) => {
        descendants.push(...getDescendantIds(child.id))
      })
      return descendants
    }

    folders.forEach((folder) => {
      const folderIds = getDescendantIds(folder.id)
      const count = assets.filter((asset) =>
        asset.folders?.some((assetFolder) => folderIds.includes(assetFolder.folder_id)),
      ).length
      counts.set(folder.id, count)
    })

    return counts
  }, [assets, folders])

  const totalAssets = visibleAssets.length
  const totalPlaylists = playlists?.length || 0

  const librarySummary = useMemo(() => {
    const readyCount = visibleAssets.reduce((count, asset) => {
      const info = deriveAssetDisplayInfo(asset)
      return info.warnings.length === 0 && info.issues.length === 0 ? count + 1 : count
    }, 0)

    return {
      readyCount,
      attentionCount: Math.max(visibleAssets.length - readyCount, 0),
      folderCount: currentFolders.length,
    }
  }, [currentFolders.length, visibleAssets])

  return {
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
  }
}
