'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { formatDuration } from '@/lib/utils'

export default function PlaylistsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [user, setUser] = useState<any>(null)
  const [projectId, setProjectId] = useState<string>('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    loop: true,
    items: [] as Array<{ asset_id: string; position: number }>,
  })

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
    }
    checkAuth()
  }, [router])

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects.list,
    enabled: !!user,
  })

  useEffect(() => {
    if (projects && projects.length > 0 && !projectId) {
      setProjectId(projects[0].id)
    }
  }, [projects, projectId])

  const { data: playlists, isLoading } = useQuery({
    queryKey: ['playlists', projectId],
    queryFn: () => api.playlists.list(projectId),
    enabled: !!projectId,
  })

  const { data: assets } = useQuery({
    queryKey: ['assets', projectId],
    queryFn: () => api.assets.list(projectId),
    enabled: !!projectId && (showCreate || !!editingId),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.playlists.create({ ...data, project_id: projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists', projectId] })
      resetForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.playlists.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists', projectId] })
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.playlists.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists', projectId] })
    },
  })

  const resetForm = () => {
    setFormData({ name: '', description: '', loop: true, items: [] })
    setShowCreate(false)
    setEditingId(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleEdit = (playlist: any) => {
    setEditingId(playlist.id)
    setFormData({
      name: playlist.name,
      description: playlist.description || '',
      loop: playlist.loop,
      items: playlist.items.map((item: any, idx: number) => ({
        asset_id: item.asset_id,
        position: idx,
      })),
    })
    setShowCreate(true)
  }

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this playlist?')) {
      deleteMutation.mutate(id)
    }
  }

  const addAsset = (assetId: string) => {
    setFormData({
      ...formData,
      items: [...formData.items, { asset_id: assetId, position: formData.items.length }],
    })
  }

  const removeItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items
        .filter((_, i) => i !== index)
        .map((item, i) => ({ ...item, position: i })),
    })
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex">
              <div className="flex flex-shrink-0 items-center">
                <h1 className="text-xl font-bold text-gray-900">YouTube Streaming</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <a href="/dashboard" className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700">Dashboard</a>
                <a href="/dashboard/assets" className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700">Assets</a>
                <a href="/dashboard/playlists" className="inline-flex items-center border-b-2 border-indigo-500 px-1 pt-1 text-sm font-medium text-gray-900">Playlists</a>
                <a href="/dashboard/destinations" className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700">Destinations</a>
                <a href="/dashboard/streams" className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700">Streams</a>
              </div>
            </div>
            <div className="flex items-center">
              <button onClick={() => supabase.auth.signOut().then(() => router.push('/login'))} className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">Sign out</button>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Playlists</h2>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            {showCreate ? 'Cancel' : 'Create Playlist'}
          </button>
        </div>

        {showCreate && (
          <div className="mb-6 bg-white shadow rounded-lg p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                />
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.loop}
                  onChange={(e) => setFormData({ ...formData, loop: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label className="ml-2 block text-sm text-gray-900">Loop playlist</label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assets in Playlist</label>
                {formData.items.length > 0 ? (
                  <ul className="space-y-2 mb-4">
                    {formData.items.map((item, index) => {
                      const asset = assets?.find((a: any) => a.id === item.asset_id)
                      return (
                        <li key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded">
                          <span className="text-sm">
                            {index + 1}. {asset?.filename || 'Unknown'}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            Remove
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500 mb-4">No assets added yet</p>
                )}
                
                {assets && assets.length > 0 && (
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        addAsset(e.target.value)
                        e.target.value = ''
                      }
                    }}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                  >
                    <option value="">Select asset to add...</option>
                    {assets
                      .filter((a: any) => a.compatible_for_copy)
                      .filter((a: any) => !formData.items.some(item => item.asset_id === a.id))
                      .map((asset: any) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.filename}
                        </option>
                      ))}
                  </select>
                )}
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
                >
                  {editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
          </div>
        ) : playlists && playlists.length > 0 ? (
          <div className="grid gap-4">
            {playlists.map((playlist: any) => (
              <div key={playlist.id} className="bg-white shadow rounded-lg p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-gray-900">{playlist.name}</h3>
                    {playlist.description && (
                      <p className="mt-1 text-sm text-gray-500">{playlist.description}</p>
                    )}
                    <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                      <span>{playlist.items?.length || 0} items</span>
                      <span>{playlist.loop ? '🔁 Loop enabled' : 'Play once'}</span>
                    </div>
                    {playlist.items && playlist.items.length > 0 && (
                      <ul className="mt-4 space-y-1 text-sm text-gray-600">
                        {playlist.items.slice(0, 3).map((item: any, idx: number) => (
                          <li key={idx}>
                            {idx + 1}. {item.asset?.filename || 'Unknown asset'}
                          </li>
                        ))}
                        {playlist.items.length > 3 && (
                          <li className="text-gray-400">...and {playlist.items.length - 3} more</li>
                        )}
                      </ul>
                    )}
                  </div>
                  <div className="flex space-x-2 ml-4">
                    <button
                      onClick={() => handleEdit(playlist)}
                      className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(playlist.id)}
                      className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500"
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-white shadow rounded-lg">
            <p className="text-sm text-gray-500">No playlists created yet</p>
          </div>
        )}
      </main>
    </div>
  )
}
