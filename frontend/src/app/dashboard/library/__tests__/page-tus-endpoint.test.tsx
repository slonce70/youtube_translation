import { render, waitFor } from '@testing-library/react'
import React from 'react'

import { resolveTusEndpoint } from '@/lib/tusd'

var mockPush = jest.fn()
var mockInvalidateQueries = jest.fn()
var mockRefetchQueries = jest.fn()
var mockMutateAsync = jest.fn()
var mockCreateUploadToken = jest.fn().mockResolvedValue({
  token: 'upload-token',
  expires_at: '2026-04-19T12:05:00.000Z',
})

type MockUppyInstance = {
  use: jest.Mock
  getPlugin: jest.Mock
  removePlugin: jest.Mock
  on: jest.Mock
  off: jest.Mock
  setMeta: jest.Mock
  cancelAll: jest.Mock
  removeFiles: jest.Mock
  addFiles: jest.Mock
  getFiles: jest.Mock
}

const mockUppyInstances: MockUppyInstance[] = []

function createMockUppyInstance(): MockUppyInstance {
  return {
    use: jest.fn().mockReturnThis(),
    getPlugin: jest.fn(() => null),
    removePlugin: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    setMeta: jest.fn(),
    cancelAll: jest.fn(),
    removeFiles: jest.fn(),
    addFiles: jest.fn(),
    getFiles: jest.fn(() => []),
  }
}

function mockUppyConstructor() {
  const instance = createMockUppyInstance()
  mockUppyInstances.push(instance)
  return instance
}

function mockTusPlugin() {
  return null
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    isPending: false,
    mutateAsync: mockMutateAsync,
  }),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    refetchQueries: mockRefetchQueries,
  }),
}))

jest.mock('@uppy/core', () => ({
  __esModule: true,
  default: mockUppyConstructor,
}))

jest.mock('@uppy/tus', () => ({
  __esModule: true,
  default: mockTusPlugin,
}))

jest.mock('sonner', () => ({
  toast: {
    loading: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}))

jest.mock('@/lib/api', () => ({
  api: {
    assets: {
      createUploadToken: mockCreateUploadToken,
      getUploadStatus: jest.fn(),
    },
    mediaFolders: {
      bulkMoveAssets: jest.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    status = 500
  },
}))

jest.mock('../../dashboard-context', () => ({
  useDashboardContext: () => ({
    user: { id: 'user-1' },
    quota: {
      storage: {
        used_bytes: 0,
        limit_gb: 5,
      },
    },
  }),
}))

jest.mock('../hooks/useLibraryRouteState', () => ({
  useLibraryRouteState: () => ({
    activeTab: 'assets',
    assetEmptyCopy: {},
    assetFilter: 'all',
    buildLibraryRoute: jest.fn(() => '/dashboard/library'),
    handleAssetFilterChange: jest.fn(),
    handleTabChange: jest.fn(),
    selectedFolderId: 'all',
    setSelectedFolderId: jest.fn(),
  }),
}))

jest.mock('../hooks/useLibraryPageData', () => ({
  useLibraryPageData: () => ({
    assetMap: new Map(),
    assets: [],
    currentFolders: [],
    displayedAssets: [],
    folderChildren: new Map(),
    folderItemCounts: new Map(),
    folders: [],
    isFoldersError: false,
    isLoadingAssets: false,
    isLoadingFolders: false,
    isLoadingPlaylists: false,
    librarySummary: {
      readyCount: 0,
      attentionCount: 0,
      folderCount: 0,
    },
    playlists: [],
    rootFolderId: null,
    totalAssets: 0,
    totalPlaylists: 0,
    visibleAssets: [],
  }),
}))

jest.mock('../hooks/usePlaylistManager', () => ({
  usePlaylistManager: () => ({
    addAssetToPlaylist: jest.fn(),
    createPlaylistMutation: { isPending: false },
    deletePlaylistMutation: { isPending: false },
    editingPlaylistId: null,
    handleDeletePlaylist: jest.fn(),
    handleEditPlaylist: jest.fn(),
    handleSubmitPlaylist: jest.fn(),
    playlistForm: { name: '', description: '', loop: false, items: [] },
    removePlaylistItem: jest.fn(),
    resetPlaylistForm: jest.fn(),
    setPlaylistForm: jest.fn(),
    setShowCreatePlaylist: jest.fn(),
    showCreatePlaylist: false,
    updatePlaylistMutation: { isPending: false },
  }),
}))

jest.mock('../hooks/useFolderManager', () => ({
  useFolderManager: () => ({
    closeFolderModal: jest.fn(),
    createFolderMutation: { isPending: false },
    deleteFolderMutation: { isPending: false },
    folderModalState: null,
    folderNameInput: '',
    handleFolderDelete: jest.fn(),
    handleFolderModalSubmit: jest.fn(),
    openCreateFolderModal: jest.fn(),
    openDeleteFolderModal: jest.fn(),
    openRenameFolderModal: jest.fn(),
    setFolderNameInput: jest.fn(),
    updateFolderMutation: { isPending: false },
  }),
}))

jest.mock('../hooks/useDeleteAssetsFlow', () => ({
  useDeleteAssetsFlow: () => ({
    closeDeleteModal: jest.fn(),
    deleteAssets: jest.fn(),
    deleteModalAssets: [],
    deleteModalState: {
      assetIds: [],
      forceRequired: false,
      forceTarget: null,
      open: false,
    },
    deleteSelectionHasUsage: false,
    forceTargetUsage: null,
    handleDeleteUsageCollection: jest.fn(),
    handleDeleteUsagePlaylist: jest.fn(),
    handleDeleteUsageStream: jest.fn(),
    isDeletingSelection: false,
    openDeleteModal: jest.fn(),
    pendingDeletionIds: [],
    pendingUsageActionKeys: [],
    resolveAssetsByIds: jest.fn(() => []),
    setDeleteModalState: jest.fn(),
  }),
}))

jest.mock('../hooks/useAssetSelection', () => ({
  useAssetSelection: () => ({
    allDisplayedSelected: false,
    clearAssetSelection: jest.fn(),
    hasSelection: false,
    isPartiallySelected: false,
    selectAllDisplayedAssets: jest.fn(),
    selectedAssetCount: 0,
    selectedAssets: new Set(),
    selectedAssetsArray: [],
    selectedDisplayedCount: 0,
    setSelectedAssets: jest.fn(),
    toggleAssetSelection: jest.fn(),
  }),
}))

jest.mock('../hooks/useAssetActions', () => ({
  useAssetActions: () => ({
    assetBeingRenamed: null,
    checkModalAsset: null,
    checkModalInfo: null,
    checkingAssetId: null,
    closeCheckModal: jest.fn(),
    closeRenameModal: jest.fn(),
    downloadAssetId: null,
    downloadLinkMutation: { isPending: false },
    expandedAssets: new Set(),
    handleCheckAsset: jest.fn(),
    handleDownloadAsset: jest.fn(),
    handleOptimizeAsset: jest.fn(),
    handleRenameAsset: jest.fn(),
    isCheckModalLoading: false,
    optimizingAssetId: null,
    optimizeAssetMutation: { isPending: false },
    renameValue: '',
    revalidateAssetMutation: { isPending: false },
    setRenameValue: jest.fn(),
    submitRename: jest.fn(),
    toggleAssetDetails: jest.fn(),
    updateAssetMutation: { isPending: false },
  }),
}))

jest.mock('@/components/LoadingState', () => ({
  LoadingState: () => null,
}))

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, isLoading: _isLoading, variant: _variant, size: _size, fullWidth: _fullWidth, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}))

jest.mock('@/components/ui/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@/components/ui/Tabs', () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@/components/ui/Input', () => ({
  Input: (props: any) => <input {...props} />,
}))

jest.mock('@/components/upload/UploadModal', () => ({
  UploadModal: () => null,
}))

jest.mock('@/components/AssetActionsMenu', () => ({
  AssetActionsMenu: () => null,
}))

jest.mock('@/components/library/Breadcrumbs', () => ({
  Breadcrumbs: () => null,
}))

jest.mock('@/components/library/FolderCard', () => ({
  FolderCard: () => null,
}))

jest.mock('@/components/library/AssetCard', () => ({
  AssetCard: () => null,
}))

jest.mock('../components/FolderSelectionTree', () => ({
  FolderSelectionTree: () => null,
}))

jest.mock('../components/ForceUsageList', () => ({
  ForceUsageList: () => null,
}))

jest.mock('../components/DeleteAssetsModal', () => ({
  DeleteAssetsModal: () => null,
}))

jest.mock('../components/FolderModal', () => ({
  FolderModal: () => null,
}))

jest.mock('../components/MoveAssetsModal', () => ({
  MoveAssetsModal: () => null,
}))

jest.mock('../components/RenameAssetModal', () => ({
  RenameAssetModal: () => null,
}))

jest.mock('../components/AssetValidationModal', () => ({
  AssetValidationModal: () => null,
}))

import LibraryPage from '../page'

describe('LibraryPage Tus wiring', () => {
  const originalTusdUrl = process.env.NEXT_PUBLIC_TUSD_URL

  beforeEach(() => {
    jest.clearAllMocks()
    mockUppyInstances.length = 0
    process.env.NEXT_PUBLIC_TUSD_URL = 'http://tusd.example.com/files'
  })

  afterEach(() => {
    if (originalTusdUrl === undefined) {
      delete process.env.NEXT_PUBLIC_TUSD_URL
    } else {
      process.env.NEXT_PUBLIC_TUSD_URL = originalTusdUrl
    }
  })

  it('passes the resolved Tus endpoint to Uppy without doubling /files/', async () => {
    render(<LibraryPage />)

    await waitFor(() => {
      expect(mockUppyInstances).toHaveLength(1)
      expect(mockUppyInstances[0].use).toHaveBeenCalledWith(
        mockTusPlugin,
        expect.objectContaining({
          endpoint: resolveTusEndpoint('http://tusd.example.com/files'),
        }),
      )
    })

    const [, options] = mockUppyInstances[0].use.mock.calls[0]
    expect(options.endpoint).toBe('http://tusd.example.com/files/')
    expect(options.endpoint).not.toContain('/files/files/')
  })
})
