export type FrameRateBucket = 30 | 60

export interface BitrateRecommendation {
  /** Human friendly label like "4K/2160p" */
  resolutionLabel: string
  /** Minimum display height the rule applies to (inclusive) */
  minHeight: number
  /** Maximum display height the rule applies to (inclusive) */
  maxHeight: number
  /** Frame rate bucket the rule targets */
  fps: FrameRateBucket
  /** Minimum bitrate in megabits per second */
  minBitrateMbps: number
  /** Maximum bitrate in megabits per second */
  maxBitrateMbps: number
  /** Recommended bitrate in megabits per second */
  targetBitrateMbps: number
}

export interface MatchedRecommendation {
  rule: BitrateRecommendation | null
  /** The fps bucket that best matches the input (30 or 60). */
  normalizedFps: FrameRateBucket | null
  /** Whether the detected fps falls outside 30 or 60 fps guidance. */
  fpsOutOfGuideline: boolean
}

/**
 * Guidance table derived from the specs shared by the customer (YouTube live encoder recommendations).
 * Values are in megabits per second.
 */
export const BITRATE_GUIDANCE: BitrateRecommendation[] = [
  {
    resolutionLabel: '4K / 2160p',
    minHeight: 2000,
    maxHeight: 2400,
    fps: 60,
    minBitrateMbps: 20,
    maxBitrateMbps: 51,
    targetBitrateMbps: 40,
  },
  {
    resolutionLabel: '4K / 2160p',
    minHeight: 2000,
    maxHeight: 2400,
    fps: 30,
    minBitrateMbps: 13,
    maxBitrateMbps: 34,
    targetBitrateMbps: 25,
  },
  {
    resolutionLabel: '1440p',
    minHeight: 1300,
    maxHeight: 1999,
    fps: 60,
    minBitrateMbps: 9,
    maxBitrateMbps: 18,
    targetBitrateMbps: 15,
  },
  {
    resolutionLabel: '1440p',
    minHeight: 1300,
    maxHeight: 1999,
    fps: 30,
    minBitrateMbps: 6,
    maxBitrateMbps: 13,
    targetBitrateMbps: 10,
  },
  {
    resolutionLabel: '1080p',
    minHeight: 1000,
    maxHeight: 1299,
    fps: 60,
    minBitrateMbps: 4.5,
    maxBitrateMbps: 9,
    targetBitrateMbps: 7.5,
  },
  {
    resolutionLabel: '1080p',
    minHeight: 1000,
    maxHeight: 1299,
    fps: 30,
    minBitrateMbps: 3,
    maxBitrateMbps: 6,
    targetBitrateMbps: 4.5,
  },
  {
    resolutionLabel: '720p',
    minHeight: 600,
    maxHeight: 999,
    fps: 60,
    minBitrateMbps: 2.25,
    maxBitrateMbps: 6,
    targetBitrateMbps: 4.5,
  },
  {
    resolutionLabel: '720p',
    minHeight: 600,
    maxHeight: 999,
    fps: 30,
    minBitrateMbps: 1.5,
    maxBitrateMbps: 4,
    targetBitrateMbps: 3,
  },
]

/**
 * Normalizes a numeric fps value into the standard buckets (30 or 60).
 * Returns null if the fps is far from both buckets.
 */
export function normalizeFps(fpsValue: number | undefined | null): {
  bucket: FrameRateBucket | null
  outOfGuideline: boolean
} {
  if (!fpsValue || Number.isNaN(fpsValue)) {
    return { bucket: null, outOfGuideline: true }
  }

  const differenceTo30 = Math.abs(fpsValue - 30)
  const differenceTo60 = Math.abs(fpsValue - 60)

  if (differenceTo30 <= 3) {
    return { bucket: 30, outOfGuideline: false }
  }

  if (differenceTo60 <= 5) {
    return { bucket: 60, outOfGuideline: false }
  }

  // Outside guideline, but we still map to the closest bucket for range checks.
  if (differenceTo30 < differenceTo60) {
    return { bucket: 30, outOfGuideline: true }
  }

  return { bucket: 60, outOfGuideline: true }
}

/**
 * Attempts to match the supplied video height/fps pair with our guidance table.
 */
export function matchBitrateRecommendation(
  height: number | undefined | null,
  fpsValue: number | undefined | null
): MatchedRecommendation {
  if (!height || Number.isNaN(height)) {
    return { rule: null, normalizedFps: null, fpsOutOfGuideline: true }
  }

  const { bucket, outOfGuideline } = normalizeFps(fpsValue)

  const rule =
    BITRATE_GUIDANCE.find(
      (entry) =>
        height >= entry.minHeight &&
        height <= entry.maxHeight &&
        (bucket ? entry.fps === bucket : true)
    ) ??
    // As a fallback, return the closest height match ignoring fps.
    BITRATE_GUIDANCE.find(
      (entry) => height >= entry.minHeight && height <= entry.maxHeight
    ) ??
    null

  return {
    rule,
    normalizedFps: bucket,
    fpsOutOfGuideline: outOfGuideline,
  }
}

export function mbpsToKbps(value: number): number {
  return Math.round(value * 1024)
}

export function formatMbps(value: number): string {
  const rounded = value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
  return `${rounded} Mbps`
}

export function formatKbps(value: number): string {
  return `${Math.round(value).toLocaleString()} Kbps`
}
