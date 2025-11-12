export type AssetType = 'video' | 'audio'

export interface AssetUsageReference {
  id: string
  name: string
  kind: 'playlist' | 'collection' | 'stream'
  status?: string | null
  context?: string | null
}

export interface AssetUsageSummary {
  playlists: AssetUsageReference[]
  collections: AssetUsageReference[]
  streams: AssetUsageReference[]
}

export interface AssetFolderInfo {
  folder_id: string
  name: string
  is_root: boolean
}

export type LoopMode = 'loop' | 'once' | 'shuffle'

export interface Asset {
  id: string
  filename: string
  storage_path: string
  size_bytes: number
  duration_seconds?: number | null
  meta?: Record<string, unknown> | null
  asset_type: AssetType
  codec_info?: Record<string, unknown> | null
  compatible_for_copy: boolean
  validation_errors?: string[] | null
  created_at: string
  updated_at: string
  primary_folder_id?: string | null
  folders?: AssetFolderInfo[]
  usage?: AssetUsageSummary
  thumbnail_url?: string | null
}

export interface MediaFolder {
  id: string
  user_id: string
  name: string
  parent_id?: string | null
  is_root: boolean
  created_at: string
  updated_at: string
}

export interface MediaFolderBulkMoveResponse {
  updated_assets: number
}

export interface CollectionItem {
  id: string
  collection_id: string
  asset_id: string
  position: number
  loop_mode: LoopMode
  created_at: string
  updated_at: string
}

export interface CollectionItemInput {
  asset_id: string
  position: number
  loop_mode?: LoopMode
}

export interface MediaCollection {
  id: string
  user_id: string
  name: string
  description?: string | null
  collection_type: 'video_background' | 'audio_playlist'
  is_active: boolean
  origin_playlist_id?: string | null
  created_at: string
  updated_at: string
  items: CollectionItem[]
}

export interface MediaCollectionCreatePayload {
  name: string
  description?: string
  collection_type: 'video_background' | 'audio_playlist'
  is_active?: boolean
  items: CollectionItemInput[]
}

export interface MediaCollectionUpdatePayload {
  name?: string
  description?: string
  is_active?: boolean
}

export interface MediaCollectionItemsPayload {
  items: CollectionItemInput[]
}

export interface PlaylistItem {
  id: string
  playlist_id: string
  asset_id: string
  position: number
  created_at: string
}

export interface Playlist {
  id: string
  name: string
  description?: string | null
  loop: boolean
  items: PlaylistItem[]
  created_at: string
  updated_at: string
}

export interface PlaylistItemInput {
  asset_id: string
  position: number
}

export interface PlaylistValidationIssue {
  code: string
  message: string
  asset_index: number
  asset_label: string
  asset_path?: string
  expected?: string | number | null
  found?: string | number | null
}

export interface PlaylistValidationResponse {
  playlist_id: string
  compatible: boolean
  assets_count: number
  issues: PlaylistValidationIssue[]
}

export interface PlaylistCreatePayload {
  name: string
  description?: string
  loop: boolean
  items: PlaylistItemInput[]
}

export interface PlaylistUpdatePayload {
  name?: string
  description?: string
  loop?: boolean
  items?: PlaylistItemInput[]
}

export interface Destination {
  id: string
  name: string
  rtmps_url: string
  enabled: boolean
  stream_key_masked: string
  created_at: string
  updated_at: string
}

export interface DestinationCreatePayload {
  name: string
  rtmps_url: string
  stream_key: string
  enabled: boolean
}

export interface DestinationUpdatePayload {
  name?: string
  rtmps_url?: string
  stream_key?: string
  enabled?: boolean
}

export type StreamStatusValue =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export interface StreamAssetLink {
  asset_id: string
  position: number
}

export interface Stream {
  id: string
  playlist_id: string | null
  source_type: 'playlist' | 'assets'
  name?: string | null
  status: StreamStatusValue
  pid?: number | null
  log_path?: string | null
  error_message?: string | null
  started_at?: string | null
  stopped_at?: string | null
  video_collection_id?: string | null
  audio_collection_id?: string | null
  mix_mode: 'video_only' | 'audio_only' | 'mixed'
  settings_json?: Record<string, unknown>
  created_at: string
  updated_at: string
  stream_assets?: StreamAssetLink[]
}

export interface StreamStatusResponse {
  id: string
  status: StreamStatusValue
  uptime_seconds?: number | null
  is_running: boolean
  error_message?: string | null
}

export interface StreamLogsResponse {
  stream_id: string
  logs: string[]
}

export interface StreamQualityViolation {
  code: string
  message: string
  asset_id?: string | null
  filename?: string | null
  position: number
  current?: string | null
  allowed?: string | null
}

export interface StreamQualityLimits {
  min_video_bitrate_mbps?: number | null
  max_resolution_height?: number | null
  max_fps?: number | null
  max_video_bitrate_mbps?: number | null
  enforce_stream_quality: boolean
}

export interface StreamQualityRecommendation {
  resolution?: string | null
  fps?: number | null
  min_bitrate_mbps?: number | null
  max_bitrate_mbps?: number | null
  target_bitrate_mbps?: number | null
  video_codec?: string | null
  audio_codec?: string | null
}

export interface StreamAudioQualityRecommendation {
  codec?: string | null
  sample_rate_hz?: number | null
  min_bitrate_kbps?: number | null
  target_bitrate_kbps?: number | null
  channels?: number | null
}

export interface StreamQualityResponse {
  ok: boolean
  tier: string
  limits: StreamQualityLimits
  violations: StreamQualityViolation[]
  recommended?: StreamQualityRecommendation | null
  mode?: 'video' | 'audio' | 'mixed'
  audio_recommended?: StreamAudioQualityRecommendation | null
}

export interface MetricsResponse {
  system: {
    cpu: {
      percent: number
      count: number
      frequency_mhz: number | null
    }
    memory: {
      total_gb: number
      available_gb: number
      used_gb: number
      percent: number
    }
    disk: {
      total_gb: number
      used_gb: number
      free_gb: number
      percent: number
    } | null
    network: {
      bytes_sent: number
      bytes_recv: number
      packets_sent: number
      packets_recv: number
    }
  }
  streams: {
    total_streams: number
    active_streams: number
    idle_streams: number
    error_streams: number
  }
  capacity: {
    active_streams: number
    estimated_additional_capacity: number
    estimated_total_capacity: number
    cpu_limited: boolean
    memory_limited: boolean
  }
}

export interface CreateStreamPayload {
  name?: string
  destination_ids: string[]
  playlist_id?: string
  asset_ids?: string[]
  video_collection_id?: string
  audio_collection_id?: string
  mix_mode?: 'video_only' | 'audio_only' | 'mixed'
  settings_json?: Record<string, unknown>
}

export interface StreamLiveUpdatePayload {
  target: 'video' | 'audio'
  items: CollectionItemInput[]
  restart?: boolean
}

export interface CreateAssetPayload {
  filename: string
  storage_path: string
  size_bytes: number
  duration_seconds?: number | null
  meta?: Record<string, unknown> | null
  compatible_for_copy: boolean
  validation_errors?: string[] | null
}

export interface UploadWebhookResult {
  success: boolean
  file_path: string
  filename: string
  size_bytes: number
  compatible_for_copy: boolean
  validation_errors: string[]
  meta: Record<string, unknown>
  asset_id?: string
}

export interface AssetDownloadLink {
  download_url: string
  expires_at: string
}

// Admin API Types
export type SubscriptionTierKey =
  | 'free'
  | 'fhd_start'
  | 'fhd_flow'
  | 'fhd_boost'
  | 'uhd_start'
  | 'uhd_flow'
  | 'uhd_boost'

export interface QuotaUsageResponse {
  storage: {
    used_bytes: number
    used_gb: number
    limit_gb: number | null
    percent: number
    unlimited: boolean
  }
  streams: {
    active: number
    limit: number | null
    percent: number
    unlimited: boolean
  }
  destinations: {
    count: number
    limit: number | null
    percent: number
    unlimited: boolean
  }
  playlists: {
    count: number
    limit: number | null
    percent: number
    unlimited: boolean
  }
  assets: {
    count: number
    limit: number | null
    percent: number
    unlimited: boolean
  }
  streaming_hours: {
    used: number
    limit: number | null
    percent: number
    unlimited: boolean
  }
  quality: {
    max_resolution: string
    max_resolution_height: number | null
    max_fps: number | null
    allowed_video_codecs: string[]
    enforce_stream_quality: boolean
  }
  tier: SubscriptionTierKey
}

export interface AdminAccessResponse {
  user_id: string
  email: string
  full_name: string | null
  subscription_tier: SubscriptionTierKey
  subscription_status: string
  is_admin: boolean
  is_suspended: boolean
}

export interface AdminUserListItem {
  user_id: string
  email: string
  full_name: string | null
  subscription_tier: SubscriptionTierKey
  subscription_status: string
  subscription_started_at: string | null
  subscription_expires_at: string | null
  is_suspended: boolean
  current_storage_bytes: number
  total_stream_hours: number
  created_at: string
  last_login_at: string | null
}

export interface AdminUserDetail extends AdminUserListItem {
  company_name: string | null
  is_admin: boolean
  suspension_reason: string | null
  assets_count: number
  playlists_count: number
  destinations_count: number
  streams_count: number
  active_streams_count: number
  updated_at: string
}

export interface AdminStreamListItem {
  stream_id: string
  user_id: string
  user_email: string
  name: string
  status: string
  playlist_id: string
  destinations_count: number
  started_at: string | null
  created_at: string
}

export interface AdminAlertListItem {
  alert_id: string
  user_id: string
  user_email: string
  alert_type: string
  severity: 'warning' | 'critical'
  message: string
  resolved: boolean
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export interface AdminActionLog {
  id: string
  admin_user_id: string
  admin_email: string
  action_type: string
  target_user_id: string | null
  target_user_email: string | null
  details: Record<string, any>
  created_at: string
}
