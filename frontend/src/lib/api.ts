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
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...fetchOptions.headers,
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
    list: () => apiRequest('/projects'),
    get: (id: string) => apiRequest(`/projects/${id}`),
    create: (data: any) => apiRequest('/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiRequest(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest(`/projects/${id}`, { method: 'DELETE' }),
  },
  
  assets: {
    list: (projectId: string) => apiRequest(`/assets?project_id=${projectId}`),
    get: (id: string) => apiRequest(`/assets/${id}`),
    delete: (id: string) => apiRequest(`/assets/${id}`, { method: 'DELETE' }),
  },
  
  playlists: {
    list: (projectId: string) => apiRequest(`/playlists?project_id=${projectId}`),
    get: (id: string) => apiRequest(`/playlists/${id}`),
    create: (data: any) => apiRequest('/playlists', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiRequest(`/playlists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest(`/playlists/${id}`, { method: 'DELETE' }),
    validate: (id: string) => apiRequest(`/playlists/${id}/validate`),
  },
  
  destinations: {
    list: (projectId: string) => apiRequest(`/destinations?project_id=${projectId}`),
    get: (id: string) => apiRequest(`/destinations/${id}`),
    create: (data: any) => apiRequest('/destinations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiRequest(`/destinations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest(`/destinations/${id}`, { method: 'DELETE' }),
  },
  
  streams: {
    list: (projectId: string) => apiRequest(`/streams?project_id=${projectId}`),
    get: (id: string) => apiRequest(`/streams/${id}`),
    create: (data: any) => apiRequest('/streams', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest(`/streams/${id}`, { method: 'DELETE' }),
    start: (id: string) => apiRequest(`/streams/${id}/start`, { method: 'POST' }),
    stop: (id: string) => apiRequest(`/streams/${id}/stop`, { method: 'POST' }),
    status: (id: string) => apiRequest(`/streams/${id}/status`),
    logs: (id: string, lines?: number) => apiRequest(`/streams/${id}/logs`, { params: { lines: lines || 100 } }),
  },
  
  metrics: {
    get: () => apiRequest('/metrics'),
  },
}
