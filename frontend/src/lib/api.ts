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
  MediaFolder,
  MediaFolderBulkMoveResponse,
  MediaCollection,
  MediaCollectionCreatePayload,
  MediaCollectionUpdatePayload,
  MediaCollectionItemsPayload,
  StreamLiveUpdatePayload,
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
    list: (params?: { asset_type?: 'video' | 'audio'; folder_id?: string }) =>
      apiRequest<Asset[]>('/assets', { params }),
    get: (id: string) => apiRequest<Asset>(`/assets/${id}`),
    create: (data: CreateAssetPayload) => apiRequest<Asset>('/assets', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string, options?: { force?: boolean }) =>
      apiRequest<void>(`/assets/${id}`, {
        method: 'DELETE',
        params: options?.force ? { force: options.force } : undefined,
      }),
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
    liveUpdate: (id: string, payload: StreamLiveUpdatePayload) =>
      apiRequest<Stream>(`/streams/${id}/live-config`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  },

  metrics: {
    get: () => apiRequest<MetricsResponse>('/metrics'),
  },

  quota: {
    get: () => apiRequest<QuotaUsageResponse>('/quota'),
  },

  mediaFolders: {
    list: (params?: { parent_id?: string; is_root?: boolean; search?: string }) =>
      apiRequest<MediaFolder[]>('/media-folders', { params }),
    create: (data: { name: string; parent_id?: string | null }) =>
      apiRequest<MediaFolder>('/media-folders', { method: 'POST', body: JSON.stringify(data) }),
    update: (folderId: string, data: { name?: string; parent_id?: string | null }) =>
      apiRequest<MediaFolder>(`/media-folders/${folderId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (folderId: string) =>
      apiRequest<void>(`/media-folders/${folderId}`, { method: 'DELETE' }),
    bulkMoveAssets: (
      folderId: string,
      payload: { asset_ids: string[]; exclusive?: boolean }
    ) =>
      apiRequest<MediaFolderBulkMoveResponse>(`/media-folders/${folderId}/assets/bulk`, {
        method: 'POST',
        body: JSON.stringify({
          asset_ids: payload.asset_ids,
          exclusive: payload.exclusive ?? true,
        }),
      }),
  },

  mediaCollections: {
    list: (params?: {
      collection_type?: 'video_background' | 'audio_playlist'
      is_active?: boolean
      include_items?: boolean
    }) =>
      apiRequest<MediaCollection[]>('/media-collections', {
        params: params
          ? {
              collection_type: params.collection_type,
              is_active: params.is_active,
              include_items: params.include_items ?? false,
            }
          : undefined,
      }),
    get: (collectionId: string, includeItems = true) =>
      apiRequest<MediaCollection>(`/media-collections/${collectionId}`, {
        params: { include_items: includeItems },
      }),
    create: (payload: MediaCollectionCreatePayload) =>
      apiRequest<MediaCollection>('/media-collections', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (collectionId: string, payload: MediaCollectionUpdatePayload) =>
      apiRequest<MediaCollection>(`/media-collections/${collectionId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    replaceItems: (collectionId: string, payload: MediaCollectionItemsPayload) =>
      apiRequest<MediaCollection>(`/media-collections/${collectionId}/items`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    delete: (collectionId: string) =>
      apiRequest<void>(`/media-collections/${collectionId}`, { method: 'DELETE' }),
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
