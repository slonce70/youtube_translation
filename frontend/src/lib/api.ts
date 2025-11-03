import { getAccessToken } from './supabase'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api'

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean>
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { params, ...fetchOptions } = options
  
  let url = `${API_BASE_URL}${endpoint}`
  
  if (params) {
    const searchParams = new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)])
    )
    url += `?${searchParams.toString()}`
  }
  
  const token = await getAccessToken()
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  
  const response = await fetch(url, {
    ...fetchOptions,
    headers,
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(error.detail || `HTTP ${response.status}`)
  }
  
  if (response.status === 204) {
    return null as T
  }
  
  return response.json()
}

export const api = {
  projects: {
    list: () => apiRequest<any[]>('/projects'),
    get: (id: string) => apiRequest<any>(`/projects/${id}`),
    create: (data: any) => apiRequest<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiRequest<any>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest<void>(`/projects/${id}`, { method: 'DELETE' }),
  },
  
  assets: {
    list: (projectId: string) => apiRequest<any[]>(`/assets?project_id=${projectId}`),
    get: (id: string) => apiRequest<any>(`/assets/${id}`),
    delete: (id: string) => apiRequest<void>(`/assets/${id}`, { method: 'DELETE' }),
  },
  
  playlists: {
    list: (projectId: string) => apiRequest<any[]>(`/playlists?project_id=${projectId}`),
    get: (id: string) => apiRequest<any>(`/playlists/${id}`),
    create: (data: any) => apiRequest<any>('/playlists', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiRequest<any>(`/playlists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest<void>(`/playlists/${id}`, { method: 'DELETE' }),
    validate: (id: string) => apiRequest<any>(`/playlists/${id}/validate`),
  },
  
  destinations: {
    list: (projectId: string) => apiRequest<any[]>(`/destinations?project_id=${projectId}`),
    get: (id: string) => apiRequest<any>(`/destinations/${id}`),
    create: (data: any) => apiRequest<any>('/destinations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiRequest<any>(`/destinations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest<void>(`/destinations/${id}`, { method: 'DELETE' }),
  },
  
  streams: {
    list: (projectId: string) => apiRequest<any[]>(`/streams?project_id=${projectId}`),
    get: (id: string) => apiRequest<any>(`/streams/${id}`),
    create: (data: any) => apiRequest<any>('/streams', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest<void>(`/streams/${id}`, { method: 'DELETE' }),
    start: (id: string) => apiRequest<any>(`/streams/${id}/start`, { method: 'POST' }),
    stop: (id: string) => apiRequest<any>(`/streams/${id}/stop`, { method: 'POST' }),
    status: (id: string) => apiRequest<any>(`/streams/${id}/status`),
    logs: (id: string, lines?: number) => apiRequest<string>(`/streams/${id}/logs`, { params: { lines: lines || 100 } }),
  },
  
  metrics: {
    get: () => apiRequest<any>('/metrics'),
  },
}
