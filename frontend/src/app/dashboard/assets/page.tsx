'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/utils'
import Uppy from '@uppy/core'
import Tus from '@uppy/tus'
import { Dashboard } from '@uppy/react'
import '@uppy/core/dist/style.min.css'
import '@uppy/dashboard/dist/style.min.css'

export default function AssetsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [user, setUser] = useState<any>(null)
  const [projectId, setProjectId] = useState<string>('')
  const [showUpload, setShowUpload] = useState(false)
  const [uppy, setUppy] = useState<Uppy | null>(null)

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

  const { data: assets, isLoading } = useQuery({
    queryKey: ['assets', projectId],
    queryFn: () => api.assets.list(projectId),
    enabled: !!projectId,
  })

  const deleteMutation = useMutation({
    mutationFn: api.assets.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets', projectId] })
    },
  })

  useEffect(() => {
    if (!user || !projectId) return

    const uppyInstance = new Uppy({
      restrictions: {
        allowedFileTypes: ['.mp4', '.mov', '.avi', '.mkv', '.flv', '.ts'],
      },
      autoProceed: false,
    })

    uppyInstance.use(Tus, {
      endpoint: `${process.env.NEXT_PUBLIC_TUSD_URL || 'http://localhost:8080'}/files/`,
      chunkSize: 5 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
    })

    uppyInstance.on('complete', (result) => {
      if (result.successful.length > 0) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['assets', projectId] })
          setShowUpload(false)
          uppyInstance.reset()
        }, 2000)
      }
    })

    setUppy(uppyInstance)

    return () => {
      uppyInstance.close()
    }
  }, [user, projectId, queryClient])

  const handleDelete = (assetId: string) => {
    if (confirm('Are you sure you want to delete this asset?')) {
      deleteMutation.mutate(assetId)
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
                <a href="/dashboard/assets" className="inline-flex items-center border-b-2 border-indigo-500 px-1 pt-1 text-sm font-medium text-gray-900">Assets</a>
                <a href="/dashboard/playlists" className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700">Playlists</a>
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
          <h2 className="text-2xl font-bold text-gray-900">Assets</h2>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            {showUpload ? 'Cancel' : 'Upload Asset'}
          </button>
        </div>

        {showUpload && uppy && (
          <div className="mb-6">
            <Dashboard
              uppy={uppy}
              proudlyDisplayPoweredByUppy={false}
              height={400}
            />
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
          </div>
        ) : assets && assets.length > 0 ? (
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <ul className="divide-y divide-gray-200">
              {assets.map((asset: any) => (
                <li key={asset.id}>
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-indigo-600 truncate">{asset.filename}</p>
                        <div className="mt-2 flex items-center text-sm text-gray-500">
                          <span className="mr-4">{formatBytes(asset.size_bytes)}</span>
                          {asset.duration_seconds && (
                            <span className="mr-4">{formatDuration(asset.duration_seconds)}</span>
                          )}
                          {asset.compatible_for_copy ? (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                              ✓ Compatible
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                              ✗ Incompatible
                            </span>
                          )}
                        </div>
                        {asset.validation_errors && asset.validation_errors.length > 0 && (
                          <div className="mt-2 text-sm text-red-600">
                            {asset.validation_errors.map((error: string, idx: number) => (
                              <div key={idx}>• {error}</div>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(asset.id)}
                        className="ml-4 flex-shrink-0 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500"
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-center py-12 bg-white shadow rounded-lg">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="mt-4 text-sm text-gray-500">No assets uploaded yet</p>
            <button
              onClick={() => setShowUpload(true)}
              className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Upload your first asset
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
