'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Uppy from '@uppy/core'
import type { UppyFile } from '@uppy/core'
import MediaInfoFactory, { type MediaInfo } from 'mediainfo.js'
import mediaInfoWasmUrl from 'mediainfo.js/MediaInfoModule.wasm'
import { toast } from 'sonner'
import {
  AlertCircle,
  CheckCircle2,
  FileVideo,
  Info,
  Loader2,
  Upload,
  Waves,
  X,
  XCircle,
  Trash2,
} from 'lucide-react'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Progress } from '@/components/ui/Progress'
import { formatBytes } from '@/lib/utils'
import { logger } from '@/lib/logger'
import type { MediaFolder } from '@/lib/types'
import {
  BITRATE_GUIDANCE,
  matchBitrateRecommendation,
  formatMbps,
} from '@/lib/videoRecommendations'

type UppyMeta = Record<string, string>
type UppyBody = Record<string, unknown>
type DashboardFile = UppyFile<UppyMeta, UppyBody>
type UploadProgressPayload = {
  bytesUploaded: number
  bytesTotal: number | null
}

type UploadStatus = 'pending' | 'ready' | 'uploading' | 'processing' | 'complete' | 'error'

interface UploadWarningsByKind {
  video: string[]
  audio: string[]
  general: string[]
}

interface UploadAnalysis {
  containerFormat?: string
  durationSeconds?: number
  overallBitrate?: number
  video?: {
    codec?: string
    profile?: string
    width?: number
    height?: number
    fps?: number
    bitrate?: number
  }
  audio?: {
    codec?: string
    bitrate?: number
    sampleRate?: number
    channels?: number
  }
  warnings: UploadWarningsByKind
  bitrateStatus: 'within' | 'outside' | 'unknown'
  recommendationLabel?: string
  recommendationDetails?: string
  normalizedFpsLabel?: string
  isLikelyCompatible?: boolean
}

interface UploadItem {
  id: string
  name: string
  size: number
  status: UploadStatus
  progress: number
  bytesUploaded: number
  bytesTotal: number
  error?: string
  analysis?: UploadAnalysis
  assetKind: 'video' | 'audio'
}

interface UploadModalProps {
  isOpen: boolean
  onClose: () => void
  uppy: Uppy<Record<string, string>, Record<string, any>>
  isProcessingUpload: boolean
  folders?: MediaFolder[]
}

type Translate = ReturnType<typeof useTranslations>

interface MediaInfoJson {
  media?: {
    track?: Array<Record<string, any>>
  }
}

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'mkv',
  'flv',
  'wmv',
  'avi',
  'webm',
  'm4v',
  'mpg',
  'mpeg',
  'ts',
  'm2ts',
])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'aac', 'flac', 'ogg', 'oga', 'm4a', 'aiff', 'alac'])

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB

const buildAcceptList = (extensions: Set<string>, wildcard?: 'audio' | 'video') => {
  const extList = Array.from(extensions)
    .map((ext) => `.${ext}`)
    .join(',')
  if (!extList && wildcard) {
    return `${wildcard}/*`
  }
  if (wildcard) {
    return `${extList},${wildcard}/*`
  }
  return extList
}

const VIDEO_ACCEPT = buildAcceptList(VIDEO_EXTENSIONS, 'video')
const AUDIO_ACCEPT = buildAcceptList(AUDIO_EXTENSIONS)
const VIDEO_ALLOWED_TYPES = ['video/*', ...Array.from(VIDEO_EXTENSIONS).map((ext) => `.${ext}`)]
const AUDIO_ALLOWED_TYPES = Array.from(AUDIO_EXTENSIONS).map((ext) => `.${ext}`)
const COVER_ART_CODECS = new Set([
  'mjpeg',
  'jpeg',
  'jpg',
  'png',
  'bmp',
  'gif',
  'webp',
  'tiff',
])

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/[^0-9.]/g, '')
    if (!normalized) return undefined
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function parseBitrate(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value !== 'string') {
    return undefined
  }

  const match = value.match(/([\d.,]+)/)
  if (!match) return undefined
  const numeric = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(numeric)) return undefined

  const lowered = value.toLowerCase()
  if (lowered.includes('g')) {
    if (lowered.includes('ib')) return numeric * 1024 * 1024 * 1024
    return numeric * 1_000_000_000
  }
  if (lowered.includes('m')) {
    if (lowered.includes('ib')) return numeric * 1024 * 1024
    return numeric * 1_000_000
  }
  if (lowered.includes('k')) {
    if (lowered.includes('ib')) return numeric * 1024
    return numeric * 1_000
  }
  return numeric
}

function parseSampleRate(value: unknown): number | undefined {
  const parsed = parseNumber(value)
  if (!parsed) return undefined
  if (parsed > 10_000) {
    return parsed
  }
  return parsed * 1000
}

function parseFps(value: unknown): number | undefined {
  if (!value) return undefined
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value !== 'string') {
    return undefined
  }
  if (value.includes('/')) {
    const [num, denom] = value.split('/')
    const numerator = Number(num)
    const denominator = Number(denom)
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return undefined
    }
    return numerator / denominator
  }
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatBitrate(bps?: number): string {
  if (!bps || !Number.isFinite(bps)) return '—'
  if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(2)} Mbps`
  }
  if (bps >= 1_000) {
    return `${(bps / 1_000).toFixed(0)} Kbps`
  }
  return `${bps.toFixed(0)} bit/s`
}

function formatFps(fps?: number): string {
  if (!fps || !Number.isFinite(fps)) return '—'
  if (fps % 1 === 0) {
    return `${fps.toFixed(0)} FPS`
  }
  return `${fps.toFixed(2)} FPS`
}

function formatSampleRate(value?: number): string {
  if (!value || !Number.isFinite(value)) return '—'
  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)} kHz`
  }
  return `${value.toFixed(0)} Hz`
}

function firstNonEmpty(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) {
      return text
    }
  }
  return undefined
}

function normalizeVideoCodec(raw?: string): string | undefined {
  if (!raw) return undefined
  const value = raw.toLowerCase()
  if (value.includes('avc') || value.includes('h264') || value.includes('x264')) {
    return 'h264'
  }
  if (value.includes('hevc') || value.includes('h265') || value.includes('x265')) {
    return 'hevc'
  }
  if (value.includes('mpeg-4') || value.includes('mp4v') || value.includes('mp42')) {
    return 'mpeg4'
  }
  if (value.includes('vp9')) {
    return 'vp9'
  }
  return value.replace(/[^a-z0-9]/g, '') || value
}

function normalizeAudioCodec(raw?: string): string | undefined {
  if (!raw) return undefined
  const value = raw.toLowerCase()
  if (value.includes('aac') || value.includes('mp4a')) {
    return 'aac'
  }
  if (value.includes('opus')) {
    return 'opus'
  }
  if (value.includes('mp3') || value.includes('mpeg')) {
    return 'mp3'
  }
  return value.replace(/[^a-z0-9]/g, '') || value
}

function detectMediaKind(file: File | DashboardFile): { isVideo: boolean; isAudio: boolean } {
  const mime = ('type' in file ? file.type : '').toLowerCase().trim()
  const name = 'name' in file ? file.name : ''
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined
  
  logger.debug('Detecting media kind', {
    fileName: name,
    mimeType: mime || '(empty)',
    extension: ext || '(none)',
    component: 'UploadModal',
  })
  
  // First check: extension-based detection (most reliable for user-selected files)
  const hasVideoExt = ext ? VIDEO_EXTENSIONS.has(ext) : false
  const hasAudioExt = ext ? AUDIO_EXTENSIONS.has(ext) : false
  
  // If extension clearly indicates video, it's video regardless of MIME
  if (hasVideoExt) {
    logger.debug('Detected as VIDEO (video extension)', { fileName: name, ext })
    return { isVideo: true, isAudio: false }
  }
  
  // If extension clearly indicates audio AND no video MIME, it's audio
  if (hasAudioExt && !mime.startsWith('video/')) {
    logger.debug('Detected as AUDIO (audio extension, no video MIME)', { fileName: name, ext })
    return { isVideo: false, isAudio: true }
  }
  
  // Second check: MIME type (can be unreliable but provides additional info)
  if (mime) {
    if (mime.startsWith('video/')) {
      logger.debug('Detected as VIDEO (video MIME type)', { fileName: name, mime })
      return { isVideo: true, isAudio: false }
    }
    if (mime.startsWith('audio/') && !hasVideoExt) {
      logger.debug('Detected as AUDIO (audio MIME type)', { fileName: name, mime })
      return { isVideo: false, isAudio: true }
    }
  }
  
  // Unknown type - neither extension nor MIME clearly indicates type
  logger.warn('Could not determine media kind', {
    fileName: name,
    mimeType: mime || '(empty)',
    extension: ext || '(none)',
    component: 'UploadModal',
  })
  return { isVideo: false, isAudio: false }
}

function looksLikeCoverArt(video?: UploadAnalysis['video']): boolean {
  if (!video) return false
  const rawCodec = typeof video.codec === 'string' ? video.codec : ''
  const normalizedCodec = rawCodec.toLowerCase().replace(/[^a-z0-9]/g, '')
  const isCoverCodec =
    (rawCodec &&
      (COVER_ART_CODECS.has(normalizedCodec) ||
        normalizedCodec.includes('mjpeg') ||
        normalizedCodec.includes('motionjpeg') ||
        normalizedCodec.includes('image')))
    || !rawCodec

  const width = typeof video.width === 'number' && Number.isFinite(video.width) ? video.width : 0
  const height = typeof video.height === 'number' && Number.isFinite(video.height) ? video.height : 0
  const fps = typeof video.fps === 'number' && Number.isFinite(video.fps) ? video.fps : 0
  const bitrate = typeof video.bitrate === 'number' && Number.isFinite(video.bitrate) ? video.bitrate : 0

  const hasImageDimensions = width <= 4096 && height <= 4096
  const hasMinimalMotion = fps <= 1
  const hasTinyBitrate = bitrate === 0 || bitrate <= 1_000_000

  if (isCoverCodec && hasImageDimensions && hasMinimalMotion && hasTinyBitrate) {
    return true
  }

  if (!video.width && !video.height && hasMinimalMotion && hasTinyBitrate) {
    return true
  }

  return false
}

function normalizePixelFormat(raw?: string): string | undefined {
  if (!raw) return undefined
  const value = raw.toLowerCase()
  if (value.includes('yuv420') || value.includes('4:2:0')) {
    return 'yuv420p'
  }
  if (value.includes('yuv422') || value.includes('4:2:2')) {
    return 'yuv422p'
  }
  if (value.includes('yuv444') || value.includes('4:4:4')) {
    return 'yuv444p'
  }
  return value.replace(/\s+/g, '') || value
}

function formatCodecDisplay(raw?: string): string {
  if (!raw) return '—'
  return raw.toUpperCase()
}

function buildAnalysis(
  result: MediaInfoJson,
  translate: Translate,
  options?: { assetKind?: 'video' | 'audio' }
): UploadAnalysis {
  const tracks = Array.isArray(result.media?.track) ? result.media?.track ?? [] : []
  const general = tracks.find((track) => track['@type'] === 'General') ?? {}
  const videoTrack = tracks.find((track) => track['@type'] === 'Video') ?? {}
  const audioTrack = tracks.find((track) => track['@type'] === 'Audio') ?? {}
  const treatAsVideo = (options?.assetKind ?? 'video') === 'video'

  const overallBitrate = parseBitrate(general.OverallBitRate ?? general.BitRate)
  const videoBitrate =
    parseBitrate(videoTrack.BitRate ?? videoTrack.BitRate_Nominal ?? videoTrack.BitRate_Maximum) ??
    undefined
  const height = parseNumber(videoTrack.Height)
  const width = parseNumber(videoTrack.Width)
  const fps = parseFps(videoTrack.FrameRate ?? videoTrack.FrameRate_Original)
  const recommendation = matchBitrateRecommendation(height, fps)

  const rawVideoCodec = firstNonEmpty(
    videoTrack.Format,
    videoTrack.CodecID,
    videoTrack.CodecID_String,
    videoTrack.CodecID_Hint,
    videoTrack.Format_Profile
  )
  const rawAudioCodec = firstNonEmpty(
    audioTrack.Format,
    audioTrack.CodecID,
    audioTrack.CodecID_String,
    audioTrack.CodecID_Hint
  )
  const rawPixelFormat = firstNonEmpty(
    videoTrack.PixelFormat,
    videoTrack.Pixel_format,
    videoTrack.Pixel_Format,
    videoTrack.Format_Settings__PixelFormat,
    videoTrack.Format_Settings__ChromaSubsampling,
    videoTrack.ChromaSubsampling
  )
  const normalizedVideoCodec = normalizeVideoCodec(rawVideoCodec)
  const normalizedAudioCodec = normalizeAudioCodec(rawAudioCodec)
  const normalizedPixelFormat = normalizePixelFormat(rawPixelFormat)

  const warnings: UploadWarningsByKind = {
    video: [],
    audio: [],
    general: [],
  }
  let bitrateStatus: UploadAnalysis['bitrateStatus'] = 'unknown'
  const bitrateForCheck = videoBitrate ?? overallBitrate
  let isLikelyCompatible: boolean | undefined =
    normalizedVideoCodec || normalizedAudioCodec || normalizedPixelFormat ? true : undefined

  if (treatAsVideo && recommendation.rule && bitrateForCheck) {
    const bitrateMbps = bitrateForCheck / 1_000_000
    if (
      bitrateMbps >= recommendation.rule.minBitrateMbps &&
      bitrateMbps <= recommendation.rule.maxBitrateMbps
    ) {
      bitrateStatus = 'within'
    } else {
      bitrateStatus = 'outside'
      warnings.video.push(
        translate('warnings.bitrateRange', {
          resolution: recommendation.rule.resolutionLabel,
          fps: recommendation.rule.fps,
          min: recommendation.rule.minBitrateMbps,
          max: recommendation.rule.maxBitrateMbps,
          target: recommendation.rule.targetBitrateMbps,
        })
      )
    }
  }

  if (treatAsVideo && recommendation.fpsOutOfGuideline) {
    warnings.video.push(translate('warnings.fpsOutOfGuideline'))
  }

  const expectedVideoCodecLabel = 'H.264'
  const expectedAudioCodecLabel = 'AAC'
  const expectedPixelFormatLabel = 'yuv420p'

  if (treatAsVideo && normalizedVideoCodec && normalizedVideoCodec !== 'h264') {
    warnings.video.push(
      translate('warnings.videoCodec', {
        expected: expectedVideoCodecLabel,
        found: formatCodecDisplay(rawVideoCodec),
      })
    )
    isLikelyCompatible = false
  }

  if (normalizedAudioCodec && normalizedAudioCodec !== 'aac') {
    warnings.audio.push(
      translate('warnings.audioCodec', {
        expected: expectedAudioCodecLabel,
        found: formatCodecDisplay(rawAudioCodec),
      })
    )
    isLikelyCompatible = false
  }

  if (treatAsVideo && normalizedPixelFormat && normalizedPixelFormat !== 'yuv420p') {
    warnings.video.push(
      translate('warnings.pixelFormat', {
        expected: expectedPixelFormatLabel,
        found: rawPixelFormat ? rawPixelFormat : translate('warnings.unknownValue'),
      })
    )
    isLikelyCompatible = false
  }

  return {
    containerFormat: general.Format || general.Format_String,
    durationSeconds: parseNumber(general.Duration) ? parseNumber(general.Duration)! / 1000 : undefined,
    overallBitrate,
    video: {
      codec: rawVideoCodec || videoTrack.Format || videoTrack.CodecID || videoTrack.CodecID_String,
      profile: videoTrack.Format_Profile,
      width,
      height,
      fps,
      bitrate: videoBitrate,
    },
    audio: {
      codec: rawAudioCodec || audioTrack.Format || audioTrack.CodecID || audioTrack.CodecID_Hint,
      bitrate: parseBitrate(audioTrack.BitRate ?? audioTrack.BitRate_Nominal),
      sampleRate: parseSampleRate(audioTrack.SamplingRate),
      channels: parseNumber(audioTrack.Channels),
    },
    warnings,
    bitrateStatus,
    recommendationLabel: recommendation.rule
      ? translate('recommendations.label', {
          resolution: recommendation.rule.resolutionLabel,
          fps: recommendation.rule.fps,
        })
      : undefined,
    recommendationDetails: recommendation.rule
      ? translate('recommendations.details', {
          min: recommendation.rule.minBitrateMbps,
          max: recommendation.rule.maxBitrateMbps,
          target: recommendation.rule.targetBitrateMbps,
        })
      : undefined,
    normalizedFpsLabel: recommendation.normalizedFps
      ? translate('recommendations.normalizedFps', { fps: recommendation.normalizedFps })
      : undefined,
    isLikelyCompatible,
  }
}

export function UploadModal({ isOpen, onClose, uppy, isProcessingUpload, folders }: UploadModalProps) {
  const t = useTranslations('library.uploadModal')
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
  const [assetKind, setAssetKind] = useState<'video' | 'audio'>('video')
  const [targetFolderId, setTargetFolderId] = useState<string>('')
  const [isDragActive, setIsDragActive] = useState(false)
  const [mediaInfoError, setMediaInfoError] = useState<string | null>(null)
  const getStatusLabel = useCallback(
    (status: UploadStatus) => t(`status.values.${status}` as any),
    [t]
  )
const mediaInfoPromiseRef = useRef<Promise<MediaInfo<'JSON'>> | null>(null)
const mediaInfoRef = useRef<MediaInfo<'JSON'> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isMountedRef = useRef(true)
  const analysisQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const allowedFileTypes = assetKind === 'audio' ? AUDIO_ALLOWED_TYPES : VIDEO_ALLOWED_TYPES
    uppy.setOptions({
      restrictions: {
        allowedFileTypes,
        maxFileSize: MAX_UPLOAD_BYTES,
      },
    })
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [assetKind, uppy])


  useEffect(() => {
    if (!folders || folders.length === 0) {
      if (targetFolderId) {
        setTargetFolderId('')
      }
      return
    }
    if (targetFolderId && !folders.some((folder) => folder.id === targetFolderId)) {
      setTargetFolderId('')
    }
  }, [folders, targetFolderId])

  const folderOptions = useMemo(() => {
    if (!folders || folders.length === 0) return []
    const grouped = new Map<string | null, MediaFolder[]>()
    folders.forEach((folder) => {
      const key = folder.parent_id ?? null
      const siblings = grouped.get(key)
      if (siblings) {
        siblings.push(folder)
      } else {
        grouped.set(key, [folder])
      }
    })
    grouped.forEach((entries) => entries.sort((a, b) => a.name.localeCompare(b.name)))

    const traverse = (
      parentId: string | null,
      depth = 0,
      acc: { id: string; label: string }[] = []
    ) => {
      const nodes = grouped.get(parentId) ?? []
      nodes.forEach((node) => {
        const nextDepth = node.is_root ? depth : depth + 1
        if (!node.is_root) {
          const prefix = depth ? '— '.repeat(depth) : ''
          acc.push({ id: node.id, label: `${prefix}${node.name}` })
        }
        traverse(node.id, nextDepth, acc)
      })
      return acc
    }

    return traverse(null)
  }, [folders])

  useEffect(() => {
    if (!mediaInfoPromiseRef.current) {
      mediaInfoPromiseRef.current = MediaInfoFactory({
        format: 'JSON',
        locateFile: (path) => {
          if (path.endsWith('.wasm')) {
            return mediaInfoWasmUrl
          }
          return path
        },
      })
      mediaInfoPromiseRef.current
        .then((instance) => {
          mediaInfoRef.current = instance
        })
        .catch((error) => {
          logger.error('Failed to initialise MediaInfo', error, { component: 'UploadModal' })
          if (isMountedRef.current) {
            setMediaInfoError(t('errors.metadataHelper'))
          }
        })
    }
  }, [t])

  const analyzeFile = useCallback(
    (file: DashboardFile, assetKindHint: 'video' | 'audio' = 'video') => {
      const execute = async () => {
        try {
          const promise = mediaInfoPromiseRef.current
          const instance =
            mediaInfoRef.current ?? (promise ? await promise.catch(() => null) : null)
          if (!instance) {
            return
          }
          if (!mediaInfoRef.current) {
            mediaInfoRef.current = instance
          }
          const fileData = file.data
          if (!(fileData instanceof File)) {
            return
          }

          const result = await instance.analyzeData(
            () => fileData.size,
            (size, offset) =>
              new Promise<Uint8Array>((resolve, reject) => {
                const slice = fileData.slice(offset, offset + size)
                const reader = new FileReader()
                reader.onload = () => {
                  if (!reader.result) {
                    reject(new Error('Failed to read file chunk'))
                    return
                  }
                  resolve(new Uint8Array(reader.result as ArrayBuffer))
                }
                reader.onerror = () => reject(reader.error ?? new Error('File read error'))
                reader.readAsArrayBuffer(slice)
              })
          )

          const parsed = JSON.parse(result) as MediaInfoJson
          const analysis = buildAnalysis(parsed, t, { assetKind: assetKindHint })

          if (assetKindHint === 'audio' && analysis.video && !looksLikeCoverArt(analysis.video)) {
            logger.warn('Rejecting analysed file: detected real video streams while in audio mode', {
              fileName: file.name,
              codec: analysis.video.codec,
              fps: analysis.video.fps,
              component: 'UploadModal',
            })
            toast.error(t('errors.videoInAudioMode'))
            try {
              uppy.removeFile(file.id)
            } catch (removeError) {
              logger.error('Failed to remove file after audio-mode rejection', removeError, {
                component: 'UploadModal',
                fileId: file.id,
              })
            }
            if (isMountedRef.current) {
              setUploadItems((items) => items.filter((item) => item.id !== file.id))
            }
            return
          }

          if (isMountedRef.current) {
            setUploadItems((items) =>
              items.map((current) =>
                current.id === file.id
                  ? {
                      ...current,
                      status:
                        current.status === 'pending'
                          ? analysis.isLikelyCompatible === false
                            ? 'pending'
                            : 'ready'
                          : current.status,
                      analysis,
                    }
                  : current
              )
            )
          }
        } catch (error) {
          logger.error('Failed to analyse media info', error, {
            component: 'UploadModal',
            fileId: file.id,
          })
          if (isMountedRef.current) {
            setUploadItems((items) =>
              items.map((current) =>
                current.id === file.id
                  ? {
                      ...current,
                      status: current.status,
                      analysis: {
                        warnings: {
                          video: [],
                          audio: [],
                          general: [t('warnings.metadataUnavailable')],
                        },
                        bitrateStatus: 'unknown',
                        isLikelyCompatible: undefined,
                      },
                    }
                  : current
              )
            )
          }
        }
      }

      const chain = analysisQueueRef.current?.catch(() => undefined) ?? Promise.resolve()
      analysisQueueRef.current = chain.then(() => execute())
      return analysisQueueRef.current
    },
    [t, uppy]
  )

  useEffect(() => {
    const handleFileAdded = (file: DashboardFile) => {
      const fileKind = file.meta?.asset_type === 'audio' ? 'audio' : 'video'
      setUploadItems((items) => {
        if (items.some((item) => item.id === file.id)) {
          return items
        }
        const size =
          typeof file.size === 'number'
            ? file.size
            : file.data instanceof File
            ? file.data.size
            : 0
        return [
          ...items,
          {
            id: file.id,
            name: file.name,
            size,
            status: 'pending',
            progress: 0,
            bytesUploaded: 0,
            bytesTotal: size,
            assetKind: fileKind,
          },
        ]
      })
      void analyzeFile(file, fileKind)
    }

    const handleFileRemoved = (file: DashboardFile) => {
      setUploadItems((items) => items.filter((item) => item.id !== file.id))
    }

    const handleUploadProgress = (
      file: DashboardFile | undefined,
      progressData: UploadProgressPayload
    ) => {
      if (!file) return
      const total = progressData.bytesTotal ?? file.size ?? progressData.bytesUploaded
      setUploadItems((items) =>
        items.map((item) =>
          item.id === file.id
            ? {
                ...item,
                status: 'uploading',
                bytesUploaded: progressData.bytesUploaded,
                bytesTotal: total,
                progress: total
                  ? Math.round((progressData.bytesUploaded / total) * 100)
                  : item.progress,
              }
            : item
        )
      )
    }

    const handleUploadSuccess = (file?: DashboardFile) => {
      if (!file) return
      setUploadItems((items) =>
        items.map((item) =>
          item.id === file.id
            ? {
                ...item,
                status: 'processing',
                progress: 100,
                bytesUploaded: item.bytesTotal,
              }
            : item
        )
      )
    }

    const handleUploadError = (
      file: DashboardFile | undefined,
      error: Error
    ) => {
      if (!file) return
      setUploadItems((items) =>
        items.map((item) =>
          item.id === file.id
            ? {
                ...item,
                status: 'error',
                error: error.message,
              }
            : item
        )
      )
    }

    const handleComplete = () => {
      setUploadItems((items) =>
        items.map((item) =>
          item.status === 'error'
            ? item
            : {
                ...item,
                status: 'complete',
                progress: 100,
              }
        )
      )
    }

    uppy.on('file-added', handleFileAdded)
    uppy.on('file-removed', handleFileRemoved)
    uppy.on('upload-progress', handleUploadProgress)
    uppy.on('upload-success', handleUploadSuccess)
    uppy.on('upload-error', handleUploadError)
    uppy.on('complete', handleComplete)

    return () => {
      uppy.off('file-added', handleFileAdded)
      uppy.off('file-removed', handleFileRemoved)
      uppy.off('upload-progress', handleUploadProgress)
      uppy.off('upload-success', handleUploadSuccess)
      uppy.off('upload-error', handleUploadError)
      uppy.off('complete', handleComplete)
    }
  }, [uppy, analyzeFile])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isProcessingUpload && !hasBlockingUpload) {
        onClose()
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  })

  const hasBlockingUpload = useMemo(
    () =>
      isProcessingUpload ||
      uploadItems.some((item) => item.status === 'uploading' || item.status === 'processing'),
    [isProcessingUpload, uploadItems]
  )

  const overallProgress = useMemo(() => {
    if (!uploadItems.length) return 0
    const sum = uploadItems.reduce((acc, item) => acc + item.progress, 0)
    return Math.round(sum / uploadItems.length)
  }, [uploadItems])

  const handleFilesSelected = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList) return
      const files = Array.from(fileList)
      
      logger.info(`Processing ${files.length} selected file(s) for upload`, {
        mode: assetKind,
        component: 'UploadModal',
      })
      
      for (const file of files) {
        const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined
        if (assetKind === 'audio') {
          if (!extension || !AUDIO_EXTENSIONS.has(extension)) {
            logger.warn('Rejecting file: extension not allowed in audio mode', {
              fileName: file.name,
              extension: extension ?? '(none)',
              component: 'UploadModal',
            })
            toast.error(t('errors.typeMismatchAudio'))
            continue
          }
        }

        const { isVideo, isAudio } = detectMediaKind(file)
        const desiredKind = assetKind
        
        logger.debug('Validating file', {
          fileName: file.name,
          desiredKind,
          detectedVideo: isVideo,
          detectedAudio: isAudio,
          component: 'UploadModal',
        })
        
        // Stricter validation logic
        const hasNoKind = !isVideo && !isAudio
        
        // Reject if type cannot be determined
        if (hasNoKind) {
          logger.warn('Rejecting file: unknown type', { fileName: file.name })
          toast.error(t('errors.invalidFileType', { fileName: file.name }))
          continue
        }
        
        // Validate video mode: must be video, not audio-only
        if (desiredKind === 'video') {
          if (!isVideo || (isAudio && !isVideo)) {
            logger.warn('Rejecting audio file in video mode', { fileName: file.name })
            toast.error(t('errors.audioInVideoMode'))
            continue
          }
        }
        
        // Validate audio mode: must be audio-only, not video
        if (desiredKind === 'audio') {
          if (isVideo) {
            logger.warn('Rejecting video file in audio mode', {
              fileName: file.name,
              mimeType: file.type,
            })
            toast.error(t('errors.videoInAudioMode'))
            continue
          }
          if (!isAudio) {
            logger.warn('Rejecting non-audio file in audio mode', { fileName: file.name })
            toast.error(t('errors.typeMismatchAudio'))
            continue
          }
        }

        // File passed validation, add to Uppy
        try {
          logger.info('Adding file to upload queue', {
            fileName: file.name,
            size: file.size,
            type: file.type,
            assetType: desiredKind,
          })
          
          await uppy.addFile({
            name: file.name,
            type: file.type,
            data: file,
            source: 'local',
            meta: {
              asset_type: desiredKind,
              folder_id: targetFolderId || '',
            },
          })
        } catch (error) {
          logger.error('Failed to add file to Uppy', error, {
            component: 'UploadModal',
            fileName: file.name,
          })
          toast.error(t('errors.fileAnalysisFailed'))
        }
      }
      
      // Clear file input for re-selection
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [assetKind, targetFolderId, t, uppy]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragActive(false)
      const { files } = event.dataTransfer
      if (files && files.length > 0) {
        void handleFilesSelected(files)
        event.dataTransfer.clearData()
      }
    },
    [handleFilesSelected]
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!isDragActive) {
      setIsDragActive(true)
    }
  }, [isDragActive])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (isDragActive) {
      setIsDragActive(false)
    }
  }, [isDragActive])

  const handleRemoveItem = useCallback(
    (id: string) => {
      uppy.removeFile(id)
      setUploadItems((items) => items.filter((item) => item.id !== id))
    },
    [uppy]
  )

  const handleStartUpload = useCallback(() => {
    void uppy.upload()
  }, [uppy])

  const handleClose = useCallback(() => {
    uppy.cancelAll()
    setUploadItems([])
    onClose()
  }, [uppy, onClose])

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center px-4 py-12">
        <Card className="w-full max-w-4xl animate-scale-in shadow-2xl max-h-[calc(100vh-4rem)] overflow-hidden">
          <CardContent className="relative space-y-6 overflow-y-auto p-6 max-h-[calc(100vh-4rem)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Upload className="w-5 h-5 text-primary-500" />
                {t('title')}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-3xl">
                {t('description')}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClose}
              disabled={hasBlockingUpload}
              className="gap-2"
            >
              <X className="w-4 h-4" />
              {t('actions.close')}
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('assetType.label')}
              </p>
              <div className="flex flex-wrap gap-2">
                {(['video', 'audio'] as const).map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={assetKind === option ? 'primary' : 'outline'}
                    onClick={() => setAssetKind(option)}
                  >
                    {t(`assetType.${option}` as const)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('folder.label')}
              </p>
              <select
                value={targetFolderId}
                onChange={(event) => setTargetFolderId(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="">{t('folder.rootOption')}</option>
                {folderOptions.length === 0 ? (
                  <option value="" disabled>
                    {t('folder.emptyOption')}
                  </option>
                ) : (
                  folderOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`rounded-2xl border-2 border-dashed transition-all duration-200 px-6 py-10 text-center ${
              isDragActive
                ? 'border-primary-400 bg-primary-50/60 dark:border-primary-600 dark:bg-primary-900/20'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40'
            }`}
          >
            <input
              key={assetKind}
              ref={fileInputRef}
              type="file"
              accept={assetKind === 'audio' ? AUDIO_ACCEPT : VIDEO_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => void handleFilesSelected(event.target.files)}
            />
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900/30">
                <Upload className="w-7 h-7 text-primary-500" />
              </div>
              <p className="text-base font-medium text-slate-800 dark:text-slate-200">
                {t.rich('dropzone.instructions', {
                  button: (chunks) => (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mx-1 text-primary-600 dark:text-primary-400 underline decoration-dotted"
                    >
                      {chunks}
                    </button>
                  ),
                })}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t(assetKind === 'video' ? 'dropzone.hintVideo' : 'dropzone.hintAudio')}
              </p>
            </div>
          </div>

          {mediaInfoError ? (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
              <AlertCircle className="mt-0.5 h-5 w-5" />
              <p className="text-sm">{mediaInfoError}</p>
            </div>
          ) : null}

          {uploadItems.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Waves className="w-4 h-4" />
                <span>{t('stats.total', { count: uploadItems.length })}</span>
                <span>·</span>
                <span>{t('stats.overall', { progress: overallProgress })}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={uploadItems.length === 0 || hasBlockingUpload}
                  onClick={() => setUploadItems([])}
                >
                  {t('actions.clear')}
                </Button>
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={handleStartUpload}
                    disabled={
                      uploadItems.length === 0 ||
                      uploadItems.every(
                        (item) =>
                          item.status === 'complete' ||
                          item.status === 'processing' ||
                          item.status === 'error'
                      )
                    }
                  >
                    <Upload className="w-4 h-4" />
                    {t('actions.start')}
                  </Button>
                </div>
              </div>

              <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                {uploadItems.map((item) => {
                  const statusLabel =
                    item.analysis?.isLikelyCompatible === false
                      ? t('status.values.needsEncoding')
                      : getStatusLabel(item.status)
                  const statusClass =
                    item.analysis?.isLikelyCompatible === false
                      ? 'capitalize text-error-600 dark:text-error-400'
                      : 'capitalize text-slate-700 dark:text-slate-300'
                  const warnings = item.analysis?.warnings
                  const hasWarnings =
                    !!warnings &&
                    (warnings.video.length || warnings.audio.length || warnings.general.length)

                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-4 space-y-3 shadow-sm"
                    >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-slate-900 dark:text-white font-medium">
                          <FileVideo className="w-4 h-4 text-primary-500" />
                          <span className="truncate max-w-[26rem]">{item.name}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <span>{formatBytes(item.size)}</span>
                          <span>·</span>
                            <span>
                              {t('status.label')}{' '}
                              <span className={statusClass}>{statusLabel}</span>
                            </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveItem(item.id)}
                        disabled={item.status === 'uploading' || item.status === 'processing'}
                        title={t('actions.remove')}
                        aria-label={t('actions.remove')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <Progress value={item.progress} />
                      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>
                          {t('progress.uploaded', {
                            uploaded: item.bytesUploaded ? formatBytes(item.bytesUploaded) : '0',
                            total: formatBytes(item.bytesTotal),
                          })}
                        </span>
                        <span>{item.progress}%</span>
                      </div>
                    </div>

                    {item.analysis?.recommendationLabel ? (
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <CheckCircle2 className="w-4 h-4 text-primary-500" />
                        <span>
                          {t('recommendations.summary', {
                            label: item.analysis.recommendationLabel,
                            details: item.analysis.recommendationDetails,
                          })}
                        </span>
                      </div>
                    ) : null}

                    {hasWarnings ? (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>
                          {t('warnings.summary', {
                            count:
                              (warnings?.video.length ?? 0) +
                              (warnings?.audio.length ?? 0) +
                              (warnings?.general.length ?? 0),
                          })}
                        </span>
                      </div>
                    ) : item.analysis && item.analysis.bitrateStatus === 'within' ? (
                      <div className="flex items-start gap-2 text-sm text-success-600 dark:text-success-400">
                        <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{t('recommendations.success')}</span>
                      </div>
                    ) : null}

                    {item.analysis ? (
                      <details className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/40">
                        <summary className="cursor-pointer list-none text-sm font-medium text-slate-700 dark:text-slate-200">
                          {t('details.summary')}
                        </summary>
                        <div className="mt-3 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-600 dark:text-slate-300">
                            <div className="flex flex-col gap-1 bg-white dark:bg-slate-900/60 rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                {t('media.video')}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary">
                                  {item.analysis.video?.codec?.toUpperCase() ?? '—'}
                                </Badge>
                                <span>{formatBitrate(item.analysis.video?.bitrate)}</span>
                                <span>·</span>
                                <span>
                                  {item.analysis.video?.width && item.analysis.video?.height
                                    ? `${item.analysis.video.width}×${item.analysis.video.height}`
                                    : '—'}
                                </span>
                                <span>·</span>
                                <span>{formatFps(item.analysis.video?.fps)}</span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1 bg-white dark:bg-slate-900/60 rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                {t('media.audio')}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary">
                                  {item.analysis.audio?.codec?.toUpperCase() ?? '—'}
                                </Badge>
                                <span>{formatBitrate(item.analysis.audio?.bitrate)}</span>
                                <span>·</span>
                                <span>{formatSampleRate(item.analysis.audio?.sampleRate)}</span>
                                {item.analysis.audio?.channels ? (
                                  <>
                                    <span>·</span>
                                    <span>{t('media.channels', { count: item.analysis.audio.channels })}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          {hasWarnings ? (
                            <div className="space-y-3">
                              {warnings?.general.length ? (
                                <div className="space-y-2">
                                  {warnings.general.map((warning, warningIndex) => (
                                    <div
                                      key={`general-warning-${warningIndex}`}
                                      className="flex items-start gap-2 text-sm text-error-600 dark:text-error-400"
                                    >
                                      <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                      <span>{warning}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {warnings?.video.length ? (
                                <div className="space-y-2">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-error-500 dark:text-error-300">
                                    {t('warnings.section.video')}
                                  </p>
                                  {warnings.video.map((warning, warningIndex) => (
                                    <div
                                      key={`video-warning-${warningIndex}`}
                                      className="flex items-start gap-2 text-sm text-error-600 dark:text-error-400"
                                    >
                                      <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                      <span>{warning}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {warnings?.audio.length ? (
                                <div className="space-y-2">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-error-500 dark:text-error-300">
                                    {t('warnings.section.audio')}
                                  </p>
                                  {warnings.audio.map((warning, warningIndex) => (
                                    <div
                                      key={`audio-warning-${warningIndex}`}
                                      className="flex items-start gap-2 text-sm text-error-600 dark:text-error-400"
                                    >
                                      <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                      <span>{warning}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    ) : null}

                    {item.error ? (
                      <div className="flex items-start gap-2 text-sm text-error-600 dark:text-error-400">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{item.error}</span>
                      </div>
                    ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="text-center text-sm text-slate-500 dark:text-slate-400">
              {t('empty.description')}
            </div>
          )}

          <details className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <summary className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 text-sm font-medium text-slate-600 dark:text-slate-300 cursor-pointer list-none">
              {t('table.title')}
            </summary>
            <div className="space-y-4 border-t border-slate-200 dark:border-slate-700 p-4">
              <div className="flex items-start gap-3 rounded-xl bg-primary-50 dark:bg-slate-800/70 px-4 py-3 border border-primary-100 dark:border-primary-900/40">
                <Info className="w-5 h-5 text-primary-500 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-primary-700 dark:text-primary-300">
                    {t('info.title')}
                  </p>
                  <a
                    href="https://support.google.com/youtube/answer/2853702"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary-600 dark:text-primary-400 underline"
                  >
                    {t('info.link')}
                  </a>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
                  <thead className="bg-white dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">{t('table.columns.resolution')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.columns.frameRate')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.columns.minimum')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.columns.maximum')}</th>
                      <th className="px-4 py-3 text-left font-medium">{t('table.columns.recommended')}</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-slate-900/40 divide-y divide-slate-200 dark:divide-slate-800">
                    {BITRATE_GUIDANCE.map((row, index) => (
                      <tr key={`${row.resolutionLabel}-${row.fps}-${index}`}>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                          {row.resolutionLabel}
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                          {row.fps} FPS
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {formatMbps(row.minBitrateMbps)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {formatMbps(row.maxBitrateMbps)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {formatMbps(row.targetBitrateMbps)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          {isProcessingUpload && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm rounded-xl">
              <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('overlay.processing')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  </div>
)
}
