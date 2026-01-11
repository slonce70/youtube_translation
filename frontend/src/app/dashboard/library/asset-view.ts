import type { Asset } from '@/lib/types'
import { deriveAssetDisplayInfo } from './asset-utils'

export type AssetSortValue = 'newest' | 'oldest' | 'nameAsc' | 'nameDesc' | 'sizeDesc' | 'sizeAsc'

export type AssetViewFilters = {
  query: string
  sort: AssetSortValue
  inUseOnly: boolean
  warningsOnly: boolean
}

export function isAssetInUse(asset: Asset): boolean {
  const usage = asset.usage
  if (!usage) return false
  const playlists = usage.playlists?.length ?? 0
  const collections = usage.collections?.length ?? 0
  const streams = usage.streams?.length ?? 0
  return playlists + collections + streams > 0
}

export function assetHasWarnings(asset: Asset): boolean {
  if (!asset.compatible_for_copy) return true
  const info = deriveAssetDisplayInfo(asset)
  return info.issues.length > 0 || info.warnings.length > 0
}

export function applyAssetView(assets: Asset[], filters: AssetViewFilters): Asset[] {
  const query = filters.query.trim().toLowerCase()
  let next = assets

  if (query) {
    next = next.filter((asset) => asset.filename.toLowerCase().includes(query))
  }

  if (filters.inUseOnly) {
    next = next.filter(isAssetInUse)
  }

  if (filters.warningsOnly) {
    next = next.filter(assetHasWarnings)
  }

  const sorted = [...next].sort((a, b) => {
    switch (filters.sort) {
      case 'oldest':
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      case 'nameAsc':
        return a.filename.localeCompare(b.filename)
      case 'nameDesc':
        return b.filename.localeCompare(a.filename)
      case 'sizeAsc':
        return (a.size_bytes ?? 0) - (b.size_bytes ?? 0)
      case 'sizeDesc':
        return (b.size_bytes ?? 0) - (a.size_bytes ?? 0)
      case 'newest':
      default:
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    }
  })

  return sorted
}

