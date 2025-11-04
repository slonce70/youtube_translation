'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Uppy from '@uppy/core'
import type { UploadResult } from '@uppy/core'
import Tus from '@uppy/tus'
import Dashboard from '@uppy/react/dashboard'
import { toast } from 'sonner'
import { 
  Upload, ListVideo, Plus, Trash2, CheckCircle, XCircle, Clock, X, 
  Loader2, List, Edit, PlayCircle 
} from 'lucide-react'

import { api } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/utils'
import { LoadingState } from '@/components/LoadingState'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Input } from '@/components/ui/Input'
import type { Asset, Playlist, PlaylistCreatePayload, PlaylistItemInput, PlaylistUpdatePayload } from '@/lib/types'
import { useDashboardContext } from '../dashboard-context'

// Uppy styles
import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'

type PlaylistFormState = PlaylistCreatePayload & { description: string }

export default function LibraryPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useDashboardContext()

  // Tab management with URL sync
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'assets')

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && (tab === 'assets' || tab === 'playlists')) {
      setActiveTab(tab)
    }
  }, [searchParams])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    router.push(`/dashboard/library?tab=${tab}`, { scroll: false })
  }

  // Assets state
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isProcessingUpload, setIsProcessingUpload] = useState(false)

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
        allowedFileTypes: ['video/*'],
        maxFileSize: 10 * 1024 * 1024 * 1024, // 10 GB
      },
    })
  )

  useEffect(() => {
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
      const toastId = toast.loading('Finalizing upload…')

      try {
        await queryClient.invalidateQueries({ queryKey: ['assets'] })
        await queryClient.refetchQueries({ queryKey: ['assets'], type: 'active' })

        toast.success('Upload processed', { id: toastId })
        setIsUploadOpen(false)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        toast.error(`Failed to refresh assets: ${message}`, { id: toastId })
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
      toast.error(`Upload failed: ${error.message}`)
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
  }, [queryClient, tusEndpoint, uppy])

  useEffect(() => {
    if (user?.id) {
      uppy.setMeta({
        user_id: user.id,
      })
    }
  }, [uppy, user?.id])

  // API Queries
  const { data: assets, isLoading: isLoadingAssets } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: () => api.assets.list(),
    enabled: !!user,
  })

  const { data: playlists, isLoading: isLoadingPlaylists } = useQuery<Playlist[]>({
    queryKey: ['playlists'],
    queryFn: () => api.playlists.list(),
    enabled: !!user,
  })

  // Mutations
  const deleteAssetMutation = useMutation({
    mutationFn: (assetId: string) => api.assets.delete(assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      toast.success('Asset deleted')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const createPlaylistMutation = useMutation({
    mutationFn: (data: PlaylistCreatePayload) => api.playlists.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      toast.success('Playlist created')
      resetPlaylistForm()
    },
    onError: (error: Error) => toast.error(error.message),
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
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      toast.success('Playlist updated')
      resetPlaylistForm()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const deletePlaylistMutation = useMutation({
    mutationFn: (playlistId: string) => api.playlists.delete(playlistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
      toast.success('Playlist deleted')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  // Handlers
  const handleDeleteAsset = (assetId: string) => {
    if (confirm('Are you sure you want to delete this asset?')) {
      deleteAssetMutation.mutate(assetId)
    }
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

  const assetsMap = useMemo(() => {
    if (!assets) return new Map<string, Asset>()
    return new Map(assets.map((asset) => [asset.id, asset]))
  }, [assets])

  const availableAssets = useMemo<Asset[]>(() => {
    if (!assets) return [] as Asset[]
    return assets
      .filter((asset) => asset.compatible_for_copy)
      .filter((asset) => !playlistForm.items.some((item) => item.asset_id === asset.id))
  }, [assets, playlistForm.items])

  // Calculate stats
  const totalAssets = assets?.length || 0
  const totalPlaylists = playlists?.length || 0
  const totalStorage = assets?.reduce((sum, asset) => sum + asset.size_bytes, 0) || 0

  if (!user) {
    return <LoadingState text="Loading library..." />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">Library</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Manage your video assets and playlists
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="assets" className="flex items-center space-x-2">
            <Upload className="w-4 h-4" />
            <span>Videos ({totalAssets})</span>
          </TabsTrigger>
          <TabsTrigger value="playlists" className="flex items-center space-x-2">
            <ListVideo className="w-4 h-4" />
            <span>Playlists ({totalPlaylists})</span>
          </TabsTrigger>
        </TabsList>

        {/* Assets Tab */}
        <TabsContent value="assets" className="mt-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Video Assets</h3>
              <Button onClick={() => setIsUploadOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Upload Video
              </Button>
            </div>

            {isLoadingAssets ? (
              <LoadingState />
            ) : assets && assets.length > 0 ? (
              <div className="grid gap-4">
                {assets.map((asset) => (
                  <Card key={asset.id} className="animate-slide-up">
                    <CardContent className="py-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0 space-y-3">
                          <div className="flex items-center space-x-3">
                            <Upload className="w-5 h-5 text-primary-500 flex-shrink-0" />
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                              {asset.filename}
                            </h3>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                            <div className="flex items-center">
                              <Clock className="w-4 h-4 mr-1" />
                              {formatBytes(asset.size_bytes)}
                            </div>
                            {asset.duration_seconds ? (
                              <div>{formatDuration(asset.duration_seconds)}</div>
                            ) : null}
                            {asset.compatible_for_copy ? (
                              <Badge variant="success">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Compatible
                              </Badge>
                            ) : (
                              <Badge variant="error">
                                <XCircle className="w-3 h-3 mr-1" />
                                Needs Transcode
                              </Badge>
                            )}
                          </div>

                          {asset.validation_errors && asset.validation_errors.length > 0 && (
                            <div className="mt-3 space-y-1">
                              {asset.validation_errors.map((error, index) => (
                                <div
                                  key={index}
                                  className="flex items-start text-sm text-error-600 dark:text-error-400"
                                >
                                  <XCircle className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0" />
                                  <span>{error}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteAsset(asset.id)}
                          isLoading={deleteAssetMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="text-center py-16">
                <div className="flex flex-col items-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/20 dark:to-accent-900/20 flex items-center justify-center">
                    <Upload className="w-8 h-8 text-primary-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                      No assets yet
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 mb-4">
                      Upload your first video asset to get started
                    </p>
                  </div>
                  <Button onClick={() => setIsUploadOpen(true)} className="gap-2">
                    <Upload className="w-4 h-4" />
                    Upload Asset
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Playlists Tab */}
        <TabsContent value="playlists" className="mt-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Playlists</h3>
              <Button onClick={() => setShowCreatePlaylist(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Create Playlist
              </Button>
            </div>

            {showCreatePlaylist && (
              <Card className="animate-scale-in">
                <CardHeader>
                  <CardTitle>{editingPlaylistId ? 'Edit Playlist' : 'New Playlist'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmitPlaylist} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Name
                      </label>
                      <Input
                        type="text"
                        required
                        value={playlistForm.name}
                        onChange={(e) => setPlaylistForm({ ...playlistForm, name: e.target.value })}
                        placeholder="My Playlist"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Description
                      </label>
                      <textarea
                        value={playlistForm.description}
                        onChange={(e) => setPlaylistForm({ ...playlistForm, description: e.target.value })}
                        rows={3}
                        placeholder="Optional description..."
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
                        Loop playlist
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Assets in Playlist
                      </label>
                      {playlistForm.items.length > 0 ? (
                        <ul className="space-y-2 mb-4">
                          {playlistForm.items.map((item, index) => {
                            const asset = assetsMap.get(item.asset_id)
                            return (
                              <li
                                key={`${item.asset_id}-${index}`}
                                className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg"
                              >
                                <span className="text-sm text-slate-900 dark:text-white">
                                  {index + 1}. {asset?.filename || 'Unknown asset'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeAssetFromPlaylist(index)}
                                  className="text-error-600 hover:text-error-800 dark:text-error-400 dark:hover:text-error-300 text-sm font-medium"
                                >
                                  Remove
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                          No assets added yet
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
                            Select asset to add...
                          </option>
                          {availableAssets.map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.filename}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Upload compatible assets to build playlists.
                        </p>
                      )}
                    </div>
                    <div className="flex justify-end gap-3">
                      <Button type="button" onClick={resetPlaylistForm} variant="secondary">
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        isLoading={createPlaylistMutation.isPending || updatePlaylistMutation.isPending}
                      >
                        {editingPlaylistId ? 'Update' : 'Create'}
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
                                Loop
                              </Badge>
                            )}
                          </div>
                          {playlist.description && (
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                              {playlist.description}
                            </p>
                          )}
                          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                            <span className="font-medium">{playlist.items?.length || 0}</span> items
                          </div>
                          {playlist.items && playlist.items.length > 0 && (
                            <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                              {playlist.items.slice(0, 3).map((item, index) => (
                                <li key={`${item.id}-${index}`} className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                                    {index + 1}.
                                  </span>
                                  {assetsMap.get(item.asset_id)?.filename || 'Unknown asset'}
                                </li>
                              ))}
                              {playlist.items.length > 3 && (
                                <li className="text-slate-400 dark:text-slate-500 italic">
                                  +{playlist.items.length - 3} more items
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
                            Edit
                          </Button>
                          <Button
                            onClick={() => handleDeletePlaylist(playlist.id)}
                            variant="danger"
                            size="sm"
                            isLoading={deletePlaylistMutation.isPending}
                            className="gap-2"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
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
                    No playlists created yet
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 mb-6">
                    Create your first playlist to organize your videos
                  </p>
                  <Button onClick={() => setShowCreatePlaylist(true)} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Create your first playlist
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
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Total Videos</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold gradient-text">{totalPlaylists}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Playlists</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold gradient-text">{formatBytes(totalStorage)}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Storage Used</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upload Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
          <Card className="w-full max-w-3xl animate-scale-in">
            <CardContent className="p-6 relative">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Upload Assets
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Videos will be automatically validated. Compatible files will appear in your assets list.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsUploadOpen(false)}
                  disabled={isProcessingUpload}
                  className="gap-2"
                >
                  <X className="w-4 h-4" />
                  Close
                </Button>
              </div>
              <Dashboard
                uppy={uppy}
                proudlyDisplayPoweredByUppy={false}
                width="100%"
                height="420px"
              />
              {isProcessingUpload && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Finalizing upload…
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
