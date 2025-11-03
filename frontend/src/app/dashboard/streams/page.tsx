'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { formatUptime } from '@/lib/utils'

export default function StreamsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [user, setUser] = useState<any>(null)
  const [projectId, setProjectId] = useState<string>('')
  const [showCreate, setShowCreate] = useState(false)
  const [viewingLogs, setViewingLogs] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    playlist_id: '',
    destination_ids: [] as string[],
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

  const { data: streams, isLoading } = useQuery({
    queryKey: ['streams', projectId],
    queryFn: () => api.streams.list(projectId),
    enabled: !!projectId,
    refetchInterval: 3000,
  })

  const { data: playlists } = useQuery({
    queryKey: ['playlists', projectId],
    queryFn: () => api.playlists.list(projectId),
    enabled: !!projectId && showCreate,
  })

  const { data: destinations } = useQuery({
    queryKey: ['destinations', projectId],
    queryFn: () => api.destinations.list(projectId),
    enabled: !!projectId && showCreate,
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.streams.create({ ...data, project_id: projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', projectId] })
      resetForm()
    },
  })

  const startMutation = useMutation({
    mutationFn: api.streams.start,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', projectId] })
    },
  })

  const stopMutation = useMutation({
    mutationFn: api.streams.stop,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', projectId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.streams.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', projectId] })
    },
  })

  const { data: logs } = useQuery({
    queryKey: ['logs', viewingLogs],
    queryFn: () => api.streams.logs(viewingLogs!, 100),
    enabled: !!viewingLogs,
    refetchInterval: 2000,
  })

  const resetForm = () => {
    setFormData({ name: '', playlist_id: '', destination_ids: [] })
    setShowCreate(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(formData)
  }

  const handleStart = (streamId: string) => {
    if (confirm('Start streaming?')) {
      startMutation.mutate(streamId)
    }
  }

  const handleStop = (streamId: string) => {
    if (confirm('Stop streaming?')) {
      stopMutation.mutate(streamId)
    }
  }

  const handleDelete = (streamId: string) => {
    if (confirm('Delete this stream? This will stop any active streaming.')) {
      deleteMutation.mutate(streamId)
    }
  }

  const toggleDestination = (destId: string) => {
    if (formData.destination_ids.includes(destId)) {
      setFormData({
        ...formData,
        destination_ids: formData.destination_ids.filter((id) => id !== destId),
      })
    } else {
      setFormData({
        ...formData,
        destination_ids: [...formData.destination_ids, destId],
      })
    }
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
                <a href="/dashboard/playlists" className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700">Playlists</a>
                <a href="/dashboard/destinations" className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700">Destinations</a>
                <a href="/dashboard/streams" className="inline-flex items-center border-b-2 border-indigo-500 px-1 pt-1 text-sm font-medium text-gray-900">Streams</a>
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
          <h2 className="text-2xl font-bold text-gray-900">Streams</h2>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            {showCreate ? 'Cancel' : 'Create Stream'}
          </button>
        </div>

        {showCreate && (
          <div className="mb-6 bg-white shadow rounded-lg p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Stream Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="24/7 Music Stream"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Playlist</label>
                <select
                  required
                  value={formData.playlist_id}
                  onChange={(e) => setFormData({ ...formData, playlist_id: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                >
                  <option value="">Select a playlist...</option>
                  {playlists?.map((playlist: any) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.name} ({playlist.items?.length || 0} items)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Destinations</label>
                {destinations && destinations.length > 0 ? (
                  <div className="space-y-2">
                    {destinations
                      .filter((d: any) => d.enabled)
                      .map((dest: any) => (
                        <div key={dest.id} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={formData.destination_ids.includes(dest.id)}
                            onChange={() => toggleDestination(dest.id)}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <label className="ml-2 block text-sm text-gray-900">{dest.name}</label>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No enabled destinations available</p>
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
                  disabled={createMutation.isPending || formData.destination_ids.length === 0}
                  className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
                >
                  Create Stream
                </button>
              </div>
            </form>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
          </div>
        ) : streams && streams.length > 0 ? (
          <div className="grid gap-4">
            {streams.map((stream: any) => (
              <div key={stream.id} className="bg-white shadow rounded-lg p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <h3 className="text-lg font-medium text-gray-900">{stream.name}</h3>
                      {stream.status === 'running' && (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                          ● Live
                        </span>
                      )}
                      {stream.status === 'idle' && (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800">
                          Idle
                        </span>
                      )}
                      {stream.status === 'error' && (
                        <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                          Error
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      Playlist: {stream.playlist?.name || 'Unknown'}
                    </p>
                    <p className="text-sm text-gray-500">
                      Destinations: {stream.destinations?.map((sd: any) => sd.destination?.name).join(', ') || 'None'}
                    </p>
                    {stream.status === 'running' && stream.uptime_seconds > 0 && (
                      <p className="mt-1 text-sm text-gray-500">
                        Uptime: {formatUptime(stream.uptime_seconds)}
                      </p>
                    )}
                  </div>
                  <div className="flex space-x-2 ml-4">
                    {stream.status === 'idle' ? (
                      <button
                        onClick={() => handleStart(stream.id)}
                        disabled={startMutation.isPending}
                        className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
                      >
                        Start
                      </button>
                    ) : stream.status === 'running' ? (
                      <button
                        onClick={() => handleStop(stream.id)}
                        disabled={stopMutation.isPending}
                        className="rounded-md bg-yellow-600 px-3 py-2 text-sm font-semibold text-white hover:bg-yellow-500 disabled:opacity-50"
                      >
                        Stop
                      </button>
                    ) : null}
                    <button
                      onClick={() => setViewingLogs(viewingLogs === stream.id ? null : stream.id)}
                      className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                    >
                      {viewingLogs === stream.id ? 'Hide Logs' : 'View Logs'}
                    </button>
                    <button
                      onClick={() => handleDelete(stream.id)}
                      disabled={deleteMutation.isPending || stream.status === 'running'}
                      className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {viewingLogs === stream.id && (
                  <div className="mt-4 bg-gray-900 rounded-lg p-4 overflow-auto max-h-96">
                    <div className="font-mono text-xs text-green-400 whitespace-pre-wrap">
                      {logs || 'Loading logs...'}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-white shadow rounded-lg">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="mt-4 text-sm text-gray-500">No streams created yet</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Create your first stream
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
