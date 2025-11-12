import { deriveAssetDisplayInfo, formatBitrateDisplay, formatFpsDisplay, formatSampleRateDisplay } from '../asset-utils'
import type { Asset } from '@/lib/types'

const baseAsset: Asset = {
  id: 'asset-1',
  filename: 'clip.mp4',
  storage_path: '/tmp/clip.mp4',
  size_bytes: 1024,
  asset_type: 'video',
  compatible_for_copy: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

const buildAsset = (overrides: Partial<Asset>): Asset => ({
  ...baseAsset,
  ...overrides,
})

describe('deriveAssetDisplayInfo', () => {
  it('surfaces codec mismatches and forces transcode warnings', () => {
    const asset = buildAsset({
      meta: {
        video: {
          codec: 'hevc',
          bitrate: 4_000_000,
          width: 1920,
          height: 1080,
          fps: 30,
        },
        audio: {
          codec: 'mp3',
          sample_rate: 44100,
        },
      },
      validation_errors: [
        'Video codec must be h264',
        'Audio codec must be one of AAC, MP3 for direct streaming.',
      ],
      compatible_for_copy: true,
    })

    const info = deriveAssetDisplayInfo(asset)
    const kinds = info.warnings.map((warning) => warning.kind)

    expect(kinds).toContain('videoCodec')
    expect(kinds).toContain('audioCodec')
    expect(kinds).toContain('requiresTranscode')
    expect(info.videoCodec).toBe('hevc')
    expect(info.audioCodec).toBe('mp3')
  })

  it('detects bitrate and fps guideline issues from metadata', () => {
    const asset = buildAsset({
      meta: {
        video: {
          codec: 'h264',
          bitrate: 500_000, // 0.5 Mbps, below 1080p guidance
          width: 1920,
          height: 1080,
          fps: 48,
        },
        audio: {
          codec: 'aac',
          sample_rate: 48000,
        },
      },
    })

    const info = deriveAssetDisplayInfo(asset)
    const kinds = info.warnings.map((warning) => warning.kind)

    expect(info.bitrateStatus).toBe('outside')
    expect(kinds).toContain('bitrateRange')
    expect(kinds).toContain('fpsOutOfGuideline')
  })

  it('marks missing metadata and copy incompatibility for audio-only assets', () => {
    const asset = buildAsset({
      asset_type: 'audio',
      meta: {
        audio: {
          codec: 'aac',
          sample_rate: 44100,
        },
      },
      compatible_for_copy: false,
    })

    const info = deriveAssetDisplayInfo(asset)
    const kinds = info.warnings.map((warning) => warning.kind)

    expect(kinds).not.toContain('missingMetadata')
    expect(kinds).not.toContain('noVideoStream')
    expect(kinds).toContain('requiresTranscode')
    expect(info.audioSampleRate).toBe(44100)
  })
})

describe('format helpers', () => {
  it('formats bitrate display ranges', () => {
    expect(formatBitrateDisplay(undefined)).toBe('—')
    expect(formatBitrateDisplay(800)).toBe('800 bit/s')
    expect(formatBitrateDisplay(50_000)).toBe('50 Kbps')
    expect(formatBitrateDisplay(2_500_000)).toBe('2.50 Mbps')
  })

  it('formats fps and sample rate values with fallbacks', () => {
    expect(formatFpsDisplay(60)).toBe('60 FPS')
    expect(formatFpsDisplay(59.94)).toBe('59.94 FPS')
    expect(formatFpsDisplay(undefined)).toBe('—')

    expect(formatSampleRateDisplay(48_000)).toBe('48 kHz')
    expect(formatSampleRateDisplay(800)).toBe('800 Hz')
    expect(formatSampleRateDisplay(undefined)).toBe('—')
  })
})
