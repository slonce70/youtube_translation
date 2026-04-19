import { renderHook } from '@testing-library/react'

const useQueryMock = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[] }) => useQueryMock(options),
}))

import { useLibraryPageData } from '../hooks/useLibraryPageData'
import type { Asset, MediaFolder, Playlist } from '@/lib/types'

const baseFolder = (overrides: Partial<MediaFolder>): MediaFolder => ({
  id: overrides.id ?? 'folder-1',
  user_id: overrides.user_id ?? 'user-1',
  name: overrides.name ?? 'Folder',
  parent_id: overrides.parent_id ?? null,
  is_root: overrides.is_root ?? false,
  created_at: overrides.created_at ?? '2026-04-01T00:00:00Z',
  updated_at: overrides.updated_at ?? '2026-04-01T00:00:00Z',
})

const baseAsset = (overrides: Partial<Asset> & { folderIds?: string[] }): Asset => ({
  id: overrides.id ?? 'asset-1',
  filename: overrides.filename ?? 'clip.mp4',
  storage_path: overrides.storage_path ?? '/uploads/clip.mp4',
  size_bytes: overrides.size_bytes ?? 1024,
  duration_seconds: overrides.duration_seconds ?? 12,
  meta: overrides.meta ?? null,
  asset_type: overrides.asset_type ?? 'video',
  codec_info: overrides.codec_info ?? null,
  compatible_for_copy: overrides.compatible_for_copy ?? true,
  validation_errors: overrides.validation_errors ?? null,
  created_at: overrides.created_at ?? '2026-04-01T00:00:00Z',
  updated_at: overrides.updated_at ?? '2026-04-01T00:00:00Z',
  primary_folder_id: overrides.primary_folder_id ?? overrides.folderIds?.[0] ?? null,
  folders:
    overrides.folders ??
    (overrides.folderIds ?? []).map((folderId) => ({
      folder_id: folderId,
      name: `Folder ${folderId}`,
      is_root: false,
    })),
  usage: overrides.usage ?? { streams: [], collections: [], playlists: [] },
  thumbnail_url: overrides.thumbnail_url ?? null,
  optimization:
    overrides.optimization ?? {
      status: 'not_requested',
      strategy: null,
      optimized_storage_path: null,
      error: null,
      updated_at: null,
      recommended_strategy: 'copy',
      can_stream_from_source: true,
    },
})

function mockLibraryQueries({
  assets,
  folders,
  playlists = [],
}: {
  assets: Asset[]
  folders: MediaFolder[]
  playlists?: Playlist[]
}) {
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    switch (queryKey[0]) {
      case 'assets':
        return { data: assets, isLoading: false }
      case 'media-folders':
        return { data: folders, isLoading: false, isError: false }
      case 'playlists':
        return { data: playlists, isLoading: false }
      default:
        throw new Error(`Unexpected query key: ${String(queryKey[0])}`)
    }
  })
}

describe('useLibraryPageData folder counts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('counts nested descendants and leaves empty folders at zero', () => {
    const root = baseFolder({ id: 'root', name: 'Root', is_root: true })
    const parent = baseFolder({ id: 'parent', name: 'Parent', parent_id: 'root' })
    const child = baseFolder({ id: 'child', name: 'Child', parent_id: 'parent' })
    const empty = baseFolder({ id: 'empty', name: 'Empty', parent_id: 'root' })

    mockLibraryQueries({
      folders: [root, parent, child, empty],
      assets: [baseAsset({ id: 'asset-child', folderIds: ['child'] })],
    })

    const { result } = renderHook(() =>
      useLibraryPageData({
        assetFilter: 'all',
        assetSearchQuery: '',
        assetSort: 'newest',
        inUseOnly: false,
        selectedFolderId: 'all',
        userId: 'user-1',
        warningsOnly: false,
      }),
    )

    expect(result.current.folderItemCounts.get('root')).toBe(1)
    expect(result.current.folderItemCounts.get('parent')).toBe(1)
    expect(result.current.folderItemCounts.get('child')).toBe(1)
    expect(result.current.folderItemCounts.get('empty')).toBe(0)
  })

  it('keeps mixed sibling and ancestor trees correct without double-counting shared branches', () => {
    const root = baseFolder({ id: 'root', name: 'Root', is_root: true })
    const parent = baseFolder({ id: 'parent', name: 'Parent', parent_id: 'root' })
    const childA = baseFolder({ id: 'child-a', name: 'Child A', parent_id: 'parent' })
    const childB = baseFolder({ id: 'child-b', name: 'Child B', parent_id: 'parent' })
    const sibling = baseFolder({ id: 'sibling', name: 'Sibling', parent_id: 'root' })

    mockLibraryQueries({
      folders: [root, parent, childA, childB, sibling],
      assets: [
        baseAsset({ id: 'asset-a', folderIds: ['child-a'] }),
        baseAsset({ id: 'asset-b', folderIds: ['child-b'] }),
        baseAsset({ id: 'asset-sibling', folderIds: ['sibling'] }),
        baseAsset({ id: 'asset-shared-branch', folderIds: ['child-a', 'parent'] }),
      ],
    })

    const { result } = renderHook(() =>
      useLibraryPageData({
        assetFilter: 'all',
        assetSearchQuery: '',
        assetSort: 'newest',
        inUseOnly: false,
        selectedFolderId: 'all',
        userId: 'user-1',
        warningsOnly: false,
      }),
    )

    expect(result.current.folderItemCounts.get('root')).toBe(4)
    expect(result.current.folderItemCounts.get('parent')).toBe(3)
    expect(result.current.folderItemCounts.get('child-a')).toBe(2)
    expect(result.current.folderItemCounts.get('child-b')).toBe(1)
    expect(result.current.folderItemCounts.get('sibling')).toBe(1)
  })
})
