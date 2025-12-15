import type { Asset } from '@/lib/types'
import { matchBitrateRecommendation } from '@/lib/videoRecommendations'

export type AssetWarning =
  | {
      kind: 'bitrateRange'
      payload: {
        resolution: string
        fps: number
        min: string
        max: string
        target: string
      }
    }
  | { kind: 'fpsOutOfGuideline' }
  | {
      kind: 'videoCodec'
      payload: { expected: string; found?: string | null }
    }
  | {
      kind: 'audioCodec'
      payload: { expected: string; found?: string | null }
    }
  | {
      kind: 'pixelFormat'
      payload: { expected: string; found?: string | null }
    }
  | {
      kind: 'gopTooLarge'
      payload: { found: string; limit: string }
    }
  | { kind: 'noVideoStream' }
  | { kind: 'noAudioStream' }
  | {
      kind: 'requiresTranscode'
      payload?: { video?: string; audio?: string; pixel?: string }
    }
  | { kind: 'missingMetadata' }
  | { kind: 'custom'; message: string }

export type AssetDisplayInfo = {
  videoCodec?: string
  videoBitrate?: number
  videoWidth?: number
  videoHeight?: number
  videoFps?: number
  audioCodec?: string
  audioBitrate?: number
  audioSampleRate?: number
  audioChannels?: number
  issues: string[]
  warnings: AssetWarning[]
  recommendationLabel?: string
  recommendationDetails?: string
  bitrateStatus: 'within' | 'outside' | 'unknown'
}

export const formatBitrateDisplay = (bps?: number): string => {
  if (!bps || !Number.isFinite(bps)) return '—'
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`
  return `${bps.toFixed(0)} bit/s`
}

export const formatFpsDisplay = (fps?: number): string => {
  if (!fps || !Number.isFinite(fps)) return '—'
  return fps % 1 === 0 ? `${fps.toFixed(0)} FPS` : `${fps.toFixed(2)} FPS`
}

export const formatSampleRateDisplay = (hz?: number): string => {
  if (!hz || !Number.isFinite(hz)) return '—'
  if (hz >= 1000) return `${(hz / 1000).toFixed(0)} kHz`
  return `${hz.toFixed(0)} Hz`
}

export const deriveAssetDisplayInfo = (asset: Asset): AssetDisplayInfo => {
  const meta = (asset.meta ?? {}) as Record<string, any>
  const video = (meta?.video ?? {}) as Record<string, any>
  const audio = (meta?.audio ?? {}) as Record<string, any>
  const backendWarnings = Array.isArray(meta?.warnings) ? (meta.warnings as string[]) : []
  const rawValidationErrors = Array.isArray(asset.validation_errors)
    ? [...(asset.validation_errors as string[])]
    : []
  const isAudioAsset = asset.asset_type === 'audio'
  const backendRecommendation = meta?.recommendation as
    | {
        label?: string
        fps?: number
        min_bitrate_mbps?: number
        max_bitrate_mbps?: number
        target_bitrate_mbps?: number
        bitrate_status?: string
        normalized_fps?: number | null
        fps_out_of_guideline?: boolean
      }
    | undefined

  const safeNumber = (value: any): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
  }

  let recommendation = matchBitrateRecommendation(
    safeNumber(video.height),
    safeNumber(video.fps)
  )

  if (backendRecommendation?.label && backendRecommendation.min_bitrate_mbps) {
    recommendation = {
      rule: {
        resolutionLabel: backendRecommendation.label,
        minHeight: 0,
        maxHeight: Number.MAX_SAFE_INTEGER,
        fps: (backendRecommendation.normalized_fps as 30 | 60 | undefined) ?? 30,
        minBitrateMbps: backendRecommendation.min_bitrate_mbps,
        maxBitrateMbps:
          backendRecommendation.max_bitrate_mbps ?? backendRecommendation.min_bitrate_mbps,
        targetBitrateMbps:
          backendRecommendation.target_bitrate_mbps ?? backendRecommendation.min_bitrate_mbps,
      },
      normalizedFps: (backendRecommendation.normalized_fps as 30 | 60 | null) ?? null,
      fpsOutOfGuideline: Boolean(backendRecommendation.fps_out_of_guideline),
    }
  } else if (isAudioAsset) {
    recommendation = { rule: null, normalizedFps: null, fpsOutOfGuideline: false }
  }

  const warnings: AssetWarning[] = []
  const STREAM_VIDEO_EXPECTED = 'H.264'
  const STREAM_AUDIO_EXPECTED = 'AAC'
  const STREAM_PIXEL_EXPECTED = 'yuv420p'

  const videoBitrate = safeNumber(video.bitrate)
  const videoFps = safeNumber(video.fps)
  const videoWidth = safeNumber(video.width)
  const videoHeight = safeNumber(video.height)
  const audioBitrate = safeNumber(audio.bitrate)
  const audioSampleRate = safeNumber(audio.sample_rate)
  const audioChannels = safeNumber(audio.channels)

  const ensureRequiresTranscode = () => {
    if (!warnings.some((warning) => warning.kind === 'requiresTranscode')) {
      warnings.push({
        kind: 'requiresTranscode',
        payload: {
          video: STREAM_VIDEO_EXPECTED,
          audio: STREAM_AUDIO_EXPECTED,
          pixel: STREAM_PIXEL_EXPECTED,
        },
      })
    }
  }

  const pushBitrateWarning = (): boolean => {
    if (isAudioAsset) return false
    const rule = recommendation.rule
    if (!rule) return false
    if (warnings.some((warning) => warning.kind === 'bitrateRange')) return true

    const resolutionLabel = rule.resolutionLabel ?? (videoHeight ? `${videoHeight}p` : '?p')
    const fpsValue = rule.fps ?? (videoFps ? Math.round(videoFps) : 0)

    warnings.push({
      kind: 'bitrateRange',
      payload: {
        resolution: resolutionLabel,
        fps: fpsValue,
        min: rule.minBitrateMbps.toFixed(0),
        max: rule.maxBitrateMbps.toFixed(0),
        target: rule.targetBitrateMbps.toFixed(0),
      },
    })
    return true
  }

  const pushFpsWarning = (): void => {
    if (isAudioAsset) return
    if (!warnings.some((warning) => warning.kind === 'fpsOutOfGuideline')) {
      warnings.push({ kind: 'fpsOutOfGuideline' })
    }
  }

  const pushVideoCodecWarning = (found?: string | null, expected: string = STREAM_VIDEO_EXPECTED) => {
    if (isAudioAsset) return
    warnings.push({
      kind: 'videoCodec',
      payload: {
        expected,
        found: found ? found.toUpperCase() : found,
      },
    })
    ensureRequiresTranscode()
  }

  const pushAudioCodecWarning = (found?: string | null, expected: string = STREAM_AUDIO_EXPECTED) => {
    warnings.push({
      kind: 'audioCodec',
      payload: {
        expected,
        found: found ? found.toUpperCase() : found,
      },
    })
    ensureRequiresTranscode()
  }

  const pushPixelFormatWarning = (found?: string | null, expected: string = STREAM_PIXEL_EXPECTED) => {
    if (isAudioAsset) return
    warnings.push({
      kind: 'pixelFormat',
      payload: {
        expected,
        found,
      },
    })
    ensureRequiresTranscode()
  }

  const pushMissingMetadataWarning = () => {
    if (!warnings.some((warning) => warning.kind === 'missingMetadata')) {
      warnings.push({ kind: 'missingMetadata' })
    }
    ensureRequiresTranscode()
  }

  const pushNoVideoStreamWarning = () => {
    if (isAudioAsset) return
    if (!warnings.some((warning) => warning.kind === 'noVideoStream')) {
      warnings.push({ kind: 'noVideoStream' })
    }
    ensureRequiresTranscode()
  }

  const pushNoAudioStreamWarning = () => {
    if (!warnings.some((warning) => warning.kind === 'noAudioStream')) {
      warnings.push({ kind: 'noAudioStream' })
    }
    ensureRequiresTranscode()
  }

  const pushGopWarning = (found: string, limit: string) => {
    if (isAudioAsset) return
    warnings.push({ kind: 'gopTooLarge', payload: { found, limit } })
    ensureRequiresTranscode()
  }

  for (const warning of backendWarnings) {
    const normalized = warning.toLowerCase()

    if (isAudioAsset) {
      if (normalized.includes('audio codec')) {
        const expectedMatch = warning.match(/must be\s+([a-z0-9\.\-]+)/i)
        const foundMatch = warning.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
        pushAudioCodecWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_AUDIO_EXPECTED).toUpperCase())
        continue
      }

      if (normalized.includes('no audio stream')) {
        pushNoAudioStreamWarning()
        continue
      }

      warnings.push({ kind: 'custom', message: warning })
      continue
    }
    if (normalized.startsWith('video bitrate is outside')) {
      if (pushBitrateWarning()) {
        continue
      }
    }

    if (normalized.startsWith('frame rate differs')) {
      pushFpsWarning()
      continue
    }

    if (normalized.includes('video codec must')) {
      const expectedMatch = warning.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = warning.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushVideoCodecWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_VIDEO_EXPECTED).toUpperCase())
      continue
    }

    if (normalized.includes('audio codec must')) {
      const expectedMatch = warning.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = warning.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushAudioCodecWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_AUDIO_EXPECTED).toUpperCase())
      continue
    }

    if (normalized.includes('pixel format must')) {
      const expectedMatch = warning.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = warning.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushPixelFormatWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_PIXEL_EXPECTED).toLowerCase())
      continue
    }

    if (normalized.includes('gop size')) {
      const sizeMatch = warning.match(/gop size[^0-9]*(\d+)/i)
      const limitMatch = warning.match(/(?:max|limit)\s*(\d+)/i)
      if (sizeMatch) {
        pushGopWarning(sizeMatch[1], limitMatch?.[1] ?? '')
        continue
      }
    }

    if (normalized.includes('no video stream')) {
      pushNoVideoStreamWarning()
      continue
    }

    if (normalized.includes('no audio stream')) {
      pushNoAudioStreamWarning()
      continue
    }

    if (normalized.includes('requires transcod')) {
      ensureRequiresTranscode()
      continue
    }

    if (normalized.includes('metadata is required') || normalized.includes('metadata is incomplete')) {
      pushMissingMetadataWarning()
      continue
    }

    warnings.push({ kind: 'custom', message: warning })
  }

  const unresolvedValidationIssues: string[] = []

  for (const issue of rawValidationErrors) {
    const normalized = issue.toLowerCase()
    let handled = false

    if (isAudioAsset) {
      if (normalized.includes('audio codec must')) {
        const expectedMatch = issue.match(/must be\s+([a-z0-9\.\-]+)/i)
        const foundMatch = issue.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
        pushAudioCodecWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_AUDIO_EXPECTED).toUpperCase())
        handled = true
      } else if (normalized.includes('no audio stream')) {
        pushNoAudioStreamWarning()
        handled = true
      }

      if (!handled) {
        unresolvedValidationIssues.push(issue)
      }
      continue
    }

    if (normalized.includes('video codec must')) {
      const expectedMatch = issue.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = issue.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushVideoCodecWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_VIDEO_EXPECTED).toUpperCase())
      handled = true
    } else if (normalized.includes('audio codec must')) {
      const expectedMatch = issue.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = issue.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushAudioCodecWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_AUDIO_EXPECTED).toUpperCase())
      handled = true
    } else if (normalized.includes('pixel format must')) {
      const expectedMatch = issue.match(/must be\s+([a-z0-9\.\-]+)/i)
      const foundMatch = issue.match(/(?:got|found)\s+([a-z0-9\.\-]+)/i)
      pushPixelFormatWarning(foundMatch?.[1] ?? null, (expectedMatch?.[1] ?? STREAM_PIXEL_EXPECTED).toLowerCase())
      handled = true
    } else if (normalized.includes('gop size')) {
      const sizeMatch = issue.match(/gop size[^0-9]*(\d+)/i)
      const limitMatch = issue.match(/(?:max|limit)\s*(\d+)/i)
      if (sizeMatch) {
        pushGopWarning(sizeMatch[1], limitMatch?.[1] ?? '')
        handled = true
      }
    } else if (normalized.includes('no video stream')) {
      pushNoVideoStreamWarning()
      handled = true
    } else if (normalized.includes('no audio stream')) {
      pushNoAudioStreamWarning()
      handled = true
    } else if (normalized.includes('requires transcod')) {
      ensureRequiresTranscode()
      handled = true
    } else if (normalized.includes('metadata is required') || normalized.includes('metadata is incomplete')) {
      pushMissingMetadataWarning()
      handled = true
    }

    if (!handled) {
      unresolvedValidationIssues.push(issue)
    }
  }

  let bitrateStatus: AssetDisplayInfo['bitrateStatus'] =
    backendRecommendation?.bitrate_status === 'within'
      ? 'within'
      : backendRecommendation?.bitrate_status === 'outside'
      ? 'outside'
      : 'unknown'

  if (!isAudioAsset && recommendation.rule && videoBitrate && bitrateStatus === 'unknown') {
    const bitrateMbps = videoBitrate / 1_000_000
    if (
      bitrateMbps >= recommendation.rule.minBitrateMbps &&
      bitrateMbps <= recommendation.rule.maxBitrateMbps
    ) {
      bitrateStatus = 'within'
    } else {
      bitrateStatus = 'outside'
      pushBitrateWarning()
    }
  }

  if (!isAudioAsset && (backendRecommendation?.fps_out_of_guideline ?? recommendation.fpsOutOfGuideline)) {
    pushFpsWarning()
  }

  const hasVideoMetadata = video && Object.keys(video).length > 0
  const hasAudioMetadata = audio && Object.keys(audio).length > 0

  if (!hasAudioMetadata) {
    pushMissingMetadataWarning()
  }

  if (!isAudioAsset && !hasVideoMetadata) {
    pushMissingMetadataWarning()
  }

  if (asset.compatible_for_copy === false) {
    ensureRequiresTranscode()
  }

  return {
    videoCodec: video.codec,
    videoBitrate,
    videoWidth,
    videoHeight,
    videoFps,
    audioCodec: audio.codec,
    audioBitrate,
    audioSampleRate,
    audioChannels,
    issues: unresolvedValidationIssues,
    warnings,
    recommendationLabel: recommendation.rule
      ? `${recommendation.rule.resolutionLabel}, ${recommendation.rule.fps} FPS`
      : undefined,
    recommendationDetails: recommendation.rule
      ? `${recommendation.rule.minBitrateMbps.toFixed(0)}–${recommendation.rule.maxBitrateMbps.toFixed(0)} Mbps · target ${recommendation.rule.targetBitrateMbps.toFixed(0)} Mbps`
      : undefined,
    bitrateStatus,
  }
}
