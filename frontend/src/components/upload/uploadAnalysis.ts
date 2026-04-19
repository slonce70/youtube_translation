import {
  matchBitrateRecommendation,
} from '@/lib/videoRecommendations'

export interface UploadWarningsByKind {
  video: string[]
  audio: string[]
  general: string[]
}

export interface UploadAnalysis {
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

export interface MediaInfoJson {
  media?: {
    track?: Array<Record<string, unknown>>
  }
}

export type UploadAnalysisTranslate = (
  key: string,
  values?: any,
  formats?: any,
) => string

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
    if (!normalized) {
      return undefined
    }

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
  if (!match) {
    return undefined
  }

  const numeric = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(numeric)) {
    return undefined
  }

  const lowered = value.toLowerCase()
  if (lowered.includes('g')) {
    if (lowered.includes('ib')) {
      return numeric * 1024 * 1024 * 1024
    }
    return numeric * 1_000_000_000
  }
  if (lowered.includes('m')) {
    if (lowered.includes('ib')) {
      return numeric * 1024 * 1024
    }
    return numeric * 1_000_000
  }
  if (lowered.includes('k')) {
    if (lowered.includes('ib')) {
      return numeric * 1024
    }
    return numeric * 1_000
  }
  return numeric
}

function parseSampleRate(value: unknown): number | undefined {
  const parsed = parseNumber(value)
  if (!parsed) {
    return undefined
  }
  if (parsed > 10_000) {
    return parsed
  }
  return parsed * 1000
}

function parseFps(value: unknown): number | undefined {
  if (!value) {
    return undefined
  }
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

function firstNonEmpty(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue
    }
    const text = String(value).trim()
    if (text) {
      return text
    }
  }
  return undefined
}

function normalizeVideoCodec(raw?: string): string | undefined {
  if (!raw) {
    return undefined
  }

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
  if (!raw) {
    return undefined
  }

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

function normalizePixelFormat(raw?: string): string | undefined {
  if (!raw) {
    return undefined
  }

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
  if (!raw) {
    return '—'
  }
  return raw.toUpperCase()
}

export function looksLikeCoverArt(video?: UploadAnalysis['video']): boolean {
  if (!video) {
    return false
  }

  const rawCodec = typeof video.codec === 'string' ? video.codec : ''
  const normalizedCodec = rawCodec.toLowerCase().replace(/[^a-z0-9]/g, '')
  const isCoverCodec =
    (rawCodec &&
      (COVER_ART_CODECS.has(normalizedCodec) ||
        normalizedCodec.includes('mjpeg') ||
        normalizedCodec.includes('motionjpeg') ||
        normalizedCodec.includes('image'))) ||
    !rawCodec

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

export function formatUploadBitrate(bps?: number): string {
  if (!bps || !Number.isFinite(bps)) {
    return '—'
  }
  if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(2)} Mbps`
  }
  if (bps >= 1_000) {
    return `${(bps / 1_000).toFixed(0)} Kbps`
  }
  return `${bps.toFixed(0)} bit/s`
}

export function formatUploadFps(fps?: number): string {
  if (!fps || !Number.isFinite(fps)) {
    return '—'
  }
  if (fps % 1 === 0) {
    return `${fps.toFixed(0)} FPS`
  }
  return `${fps.toFixed(2)} FPS`
}

export function formatUploadSampleRate(value?: number): string {
  if (!value || !Number.isFinite(value)) {
    return '—'
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)} kHz`
  }
  return `${value.toFixed(0)} Hz`
}

export function buildUploadAnalysis(
  result: MediaInfoJson,
  translate: UploadAnalysisTranslate,
  options?: { assetKind?: 'video' | 'audio' },
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
    videoTrack.Format_Profile,
  )
  const rawAudioCodec = firstNonEmpty(
    audioTrack.Format,
    audioTrack.CodecID,
    audioTrack.CodecID_String,
    audioTrack.CodecID_Hint,
  )
  const rawPixelFormat = firstNonEmpty(
    videoTrack.PixelFormat,
    videoTrack.Pixel_format,
    videoTrack.Pixel_Format,
    videoTrack.Format_Settings__PixelFormat,
    videoTrack.Format_Settings__ChromaSubsampling,
    videoTrack.ChromaSubsampling,
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
        }),
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
      }),
    )
    isLikelyCompatible = false
  }

  if (normalizedAudioCodec && normalizedAudioCodec !== 'aac') {
    warnings.audio.push(
      translate('warnings.audioCodec', {
        expected: expectedAudioCodecLabel,
        found: formatCodecDisplay(rawAudioCodec),
      }),
    )
    isLikelyCompatible = false
  }

  if (treatAsVideo && normalizedPixelFormat && normalizedPixelFormat !== 'yuv420p') {
    warnings.video.push(
      translate('warnings.pixelFormat', {
        expected: expectedPixelFormatLabel,
        found: rawPixelFormat || translate('warnings.unknownValue'),
      }),
    )
    isLikelyCompatible = false
  }

  const durationMs = parseNumber(general.Duration)

  return {
    containerFormat: (general.Format || general.Format_String) as string | undefined,
    durationSeconds: durationMs ? durationMs / 1000 : undefined,
    overallBitrate,
    video: {
      codec: rawVideoCodec || (videoTrack.Format as string | undefined) || (videoTrack.CodecID as string | undefined) || (videoTrack.CodecID_String as string | undefined),
      profile: videoTrack.Format_Profile as string | undefined,
      width,
      height,
      fps,
      bitrate: videoBitrate,
    },
    audio: {
      codec: rawAudioCodec || (audioTrack.Format as string | undefined) || (audioTrack.CodecID as string | undefined) || (audioTrack.CodecID_Hint as string | undefined),
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
