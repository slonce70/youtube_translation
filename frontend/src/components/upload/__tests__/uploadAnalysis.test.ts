import {
  buildUploadAnalysis,
  formatUploadBitrate,
  formatUploadFps,
  formatUploadSampleRate,
  looksLikeCoverArt,
} from '../uploadAnalysis'

function t(key: string, values?: Record<string, unknown>) {
  if (!values) {
    return key
  }

  return `${key}:${JSON.stringify(values)}`
}

describe('uploadAnalysis', () => {
  it('builds compatibility warnings and friendly media labels from MediaInfo JSON', () => {
    const analysis = buildUploadAnalysis(
      {
        media: {
          track: [
            {
              '@type': 'General',
              Format: 'MPEG-4',
              Duration: '12500',
              OverallBitRate: '2.0 Mb/s',
            },
            {
              '@type': 'Video',
              Format: 'HEVC',
              Height: '1080 pixels',
              Width: '1920 pixels',
              FrameRate: '30000/1001',
              BitRate: '2.0 Mb/s',
              PixelFormat: '4:2:2',
            },
            {
              '@type': 'Audio',
              Format: 'AC-3',
              BitRate: '192 kb/s',
              SamplingRate: '48.0 kHz',
              Channels: '2',
            },
          ],
        },
      },
      t,
      { assetKind: 'video' },
    )

    expect(analysis.durationSeconds).toBeCloseTo(12.5)
    expect(analysis.overallBitrate).toBe(2_000_000)
    expect(analysis.video).toMatchObject({
      codec: 'HEVC',
      width: 1920,
      height: 1080,
      bitrate: 2_000_000,
    })
    expect(analysis.video?.fps).toBeCloseTo(29.97, 2)
    expect(analysis.audio).toMatchObject({
      codec: 'AC-3',
      bitrate: 192_000,
      sampleRate: 48_000,
      channels: 2,
    })
    expect(analysis.bitrateStatus).toBe('outside')
    expect(analysis.isLikelyCompatible).toBe(false)
    expect(analysis.warnings.video.join(' ')).toContain('warnings.bitrateRange')
    expect(analysis.warnings.video.join(' ')).toContain('warnings.videoCodec')
    expect(analysis.warnings.video.join(' ')).toContain('warnings.pixelFormat')
    expect(analysis.warnings.audio.join(' ')).toContain('warnings.audioCodec')
    expect(formatUploadBitrate(2_000_000)).toBe('2.00 Mbps')
    expect(formatUploadFps(analysis.video?.fps)).toBe('29.97 FPS')
    expect(formatUploadSampleRate(analysis.audio?.sampleRate)).toBe('48 kHz')
  })

  it('treats tiny MJPEG sidecar video tracks as cover art instead of real motion video', () => {
    expect(
      looksLikeCoverArt({
        codec: 'mjpeg',
        width: 1200,
        height: 1200,
        fps: 0.5,
        bitrate: 500_000,
      }),
    ).toBe(true)

    expect(
      looksLikeCoverArt({
        codec: 'h264',
        width: 1920,
        height: 1080,
        fps: 24,
        bitrate: 4_000_000,
      }),
    ).toBe(false)
  })
})
