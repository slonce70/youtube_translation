import { getAccessToken } from './supabase'
import type {
  Asset,
  Playlist,
  PlaylistCreatePayload,
  PlaylistUpdatePayload,
  Destination,
  Stream,
  StreamStatusResponse,
  StreamLogsResponse,
  MetricsResponse,
  CreateStreamPayload,
  CreateAssetPayload,
  DestinationCreatePayload,
  DestinationUpdatePayload,
  PlaylistValidationResponse,
  AdminAccessResponse,
  AdminUserListItem,
  AdminUserDetail,
  AdminStreamListItem,
  AdminAlertListItem,
  AdminActionLog,
  AssetDownloadLink,
  StreamQualityResponse,
  SubscriptionTierKey,
  QuotaUsageResponse,
} from './types'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api'

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>
}

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    const message = typeof detail === 'string' ? detail : `HTTP ${status}`
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options

  // Ensure trailing slash for FastAPI compatibility
  const normalizedEndpoint = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  const url = new URL(`${API_BASE_URL}${normalizedEndpoint}`)

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value))
      }
    })
  }

  const token = await getAccessToken()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> | undefined),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(url.toString(), {
    ...fetchOptions,
    headers,
  })

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ detail: 'Unknown error' }))
    const detail = errorPayload?.detail ?? errorPayload
    throw new ApiError(response.status, detail)
  }

  if (response.status === 204) {
    return null as T
  }

  return response.json() as Promise<T>
}

export const api = {
  assets: {
    list: () => apiRequest<Asset[]>('/assets'),
    get: (id: string) => apiRequest<Asset>(`/assets/${id}`),
    create: (data: CreateAssetPayload) => apiRequest<Asset>('/assets', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest<void>(`/assets/${id}`, { method: 'DELETE' }),
    update: (id: string, data: Partial<Pick<Asset, 'filename'>>) =>
      apiRequest<Asset>(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    revalidate: (id: string) => apiRequest<Asset>(`/assets/${id}/check`, { method: 'POST' }),
    createDownloadLink: (id: string) =>
      apiRequest<AssetDownloadLink>(`/assets/${id}/download-link`, { method: 'POST' }),
  },

  playlists: {
    list: () => apiRequest<Playlist[]>('/playlists'),
    get: (id: string) => apiRequest<Playlist>(`/playlists/${id}`),
    create: (data: PlaylistCreatePayload) =>
      apiRequest<Playlist>('/playlists', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: PlaylistUpdatePayload) =>
      apiRequest<Playlist>(`/playlists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest<void>(`/playlists/${id}`, { method: 'DELETE' }),
    validate: (id: string) => apiRequest<PlaylistValidationResponse>(`/playlists/${id}/validate`),
  },

  destinations: {
    list: () => apiRequest<Destination[]>('/destinations'),
    get: (id: string) => apiRequest<Destination>(`/destinations/${id}`),
    create: (data: DestinationCreatePayload) =>
      apiRequest<Destination>('/destinations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: DestinationUpdatePayload) =>
      apiRequest<Destination>(`/destinations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => apiRequest<void>(`/destinations/${id}`, { method: 'DELETE' }),
  },

  streams: {
    list: () => apiRequest<Stream[]>('/streams'),
    create: (data: CreateStreamPayload) => apiRequest<Stream>('/streams', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    delete: (id: string) => apiRequest<void>(`/streams/${id}`, { method: 'DELETE' }),
    start: (id: string) => apiRequest<StreamStatusResponse>(`/streams/${id}/start`, { method: 'POST' }),
    stop: (id: string) => apiRequest<StreamStatusResponse>(`/streams/${id}/stop`, { method: 'POST' }),
    status: (id: string) => apiRequest<StreamStatusResponse>(`/streams/${id}/status`),
    logs: (id: string, lines?: number) => apiRequest<StreamLogsResponse>(`/streams/${id}/logs`, { params: { lines: lines ?? 100 } }),
    quality: (id: string) => apiRequest<StreamQualityResponse>(`/streams/${id}/quality`),
  },

  metrics: {
    get: () => apiRequest<MetricsResponse>('/metrics'),
  },

  quota: {
    get: () => apiRequest<QuotaUsageResponse>('/quota'),
  },

  admin: {
    access: () => apiRequest<AdminAccessResponse>('/admin/access'),
    users: {
      list: (params?: {
        tier?: string
        status?: string
        is_suspended?: boolean
        limit?: number
        offset?: number
      }) => {
        const queryParams: Record<string, any> | undefined = params
          ? { ...params }
          : undefined

        if (queryParams && 'is_suspended' in queryParams) {
          queryParams.suspended = queryParams.is_suspended
          delete queryParams.is_suspended
        }

        return apiRequest<AdminUserListItem[]>('/admin/users', { params: queryParams })
      },
      get: (userId: string) => apiRequest<AdminUserDetail>(`/admin/users/${userId}`),
      suspend: (userId: string, reason: string) =>
        apiRequest<AdminUserDetail>(`/admin/users/${userId}/suspend`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }),
      unsuspend: (userId: string) =>
        apiRequest<AdminUserDetail>(`/admin/users/${userId}/unsuspend`, { method: 'POST' }),
      changeTier: (userId: string, newTier: SubscriptionTierKey, reason?: string) =>
        apiRequest<AdminUserDetail>(`/admin/users/${userId}/tier`, {
          method: 'PATCH',
          body: JSON.stringify({ new_tier: newTier, reason }),
        }),
    },
    streams: {
      listAll: (params?: { status?: string; limit?: number; offset?: number }) =>
        apiRequest<AdminStreamListItem[]>('/admin/streams/all', { params }),
      forceStop: (streamId: string) =>
        apiRequest<{ stream_id: string; status: string }>(`/admin/streams/${streamId}/stop`, {
          method: 'POST',
        }),
    },
    alerts: {
      list: (params?: {
        severity?: string
        resolved?: boolean
        limit?: number
        offset?: number
      }) => apiRequest<AdminAlertListItem[]>('/admin/alerts', { params }),
      resolve: (alertId: string, resolutionNotes?: string) =>
        apiRequest<AdminAlertListItem>(`/admin/alerts/${alertId}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ resolution_notes: resolutionNotes }),
        }),
    },
    actions: {
      list: (params?: {
        action_type?: string
        admin_user_id?: string
        limit?: number
        offset?: number
      }) => apiRequest<AdminActionLog[]>('/admin/actions', { params }),
    },
  },
}
