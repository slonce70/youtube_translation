import type { Asset } from '@/lib/types'
import { applyAssetView, assetHasWarnings, isAssetInUse } from '../asset-view'

let idCounter = 0

const baseAsset = (overrides: Partial<Asset>): Asset =>
  ({
    id: overrides.id ?? `00000000-0000-0000-0000-00000000000${++idCounter}`,
    user_id: overrides.user_id ?? '00000000-0000-0000-0000-000000000001',
    filename: overrides.filename ?? 'video.mp4',
    asset_type: overrides.asset_type ?? 'video',
    size_bytes: overrides.size_bytes ?? 100,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    compatible_for_copy: overrides.compatible_for_copy ?? true,
    duration_seconds: overrides.duration_seconds ?? 10,
    meta:
      overrides.meta ??
      ({
        video: {
          codec: 'h264',
          bitrate: 4_500_000,
          width: 1920,
          height: 1080,
          fps: 30,
          pixel_format: 'yuv420p',
        },
        audio: {
          codec: 'aac',
          bitrate: 128_000,
          sample_rate: 48_000,
          channels: 2,
        },
      } as any),
    thumbnail_url: overrides.thumbnail_url ?? null,
    primary_folder_id: overrides.primary_folder_id ?? null,
    folders: overrides.folders ?? [],
    usage: overrides.usage ?? { streams: [], collections: [], playlists: [] },
  }) as Asset

describe('asset view helpers', () => {
  it('detects in-use assets', () => {
    const unused = baseAsset({ usage: { streams: [], collections: [], playlists: [] } })
    const used = baseAsset({ usage: { streams: [{ id: 's1', name: 'a', status: 'stopped' } as any], collections: [], playlists: [] } })
    expect(isAssetInUse(unused)).toBe(false)
    expect(isAssetInUse(used)).toBe(true)
  })

  it('treats incompatible assets as warnings', () => {
    const ok = baseAsset({ compatible_for_copy: true })
    const bad = baseAsset({ compatible_for_copy: false })
    expect(assetHasWarnings(ok)).toBe(false)
    expect(assetHasWarnings(bad)).toBe(true)
  })

  it('filters and sorts assets', () => {
    const assets = [
      baseAsset({ filename: 'alpha.mp4', created_at: '2026-01-01T00:00:00Z', size_bytes: 10 }),
      baseAsset({ filename: 'beta.mp4', created_at: '2026-01-03T00:00:00Z', size_bytes: 30, usage: { streams: [{ id: 's1' } as any], collections: [], playlists: [] } }),
      baseAsset({ filename: 'gamma.mp4', created_at: '2026-01-02T00:00:00Z', size_bytes: 20, compatible_for_copy: false }),
    ]

    const byNameDesc = applyAssetView(assets, { query: '', sort: 'nameDesc', inUseOnly: false, warningsOnly: false })
    expect(byNameDesc.map((a) => a.filename)).toEqual(['gamma.mp4', 'beta.mp4', 'alpha.mp4'])

    const search = applyAssetView(assets, { query: 'be', sort: 'newest', inUseOnly: false, warningsOnly: false })
    expect(search.map((a) => a.filename)).toEqual(['beta.mp4'])

    const inUseOnly = applyAssetView(assets, { query: '', sort: 'newest', inUseOnly: true, warningsOnly: false })
    expect(inUseOnly.map((a) => a.filename)).toEqual(['beta.mp4'])

    const warningsOnly = applyAssetView(assets, { query: '', sort: 'newest', inUseOnly: false, warningsOnly: true })
    expect(warningsOnly.map((a) => a.filename)).toEqual(['gamma.mp4'])
  })
})
