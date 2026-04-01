import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'

import type { Asset } from '@/lib/types'
import enMessages from '@/messages/en'

import { AssetCard } from '../AssetCard'

const baseAsset: Asset = {
  id: 'asset-1',
  filename: 'background.mp4',
  storage_path: '/uploads/background.mp4',
  size_bytes: 1024,
  duration_seconds: 12,
  meta: {},
  asset_type: 'video',
  codec_info: {},
  compatible_for_copy: true,
  validation_errors: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  usage: {
    streams: [],
    collections: [],
    playlists: [],
  },
  optimization: {
    status: 'not_requested',
    strategy: null,
    optimized_storage_path: null,
    error: null,
    updated_at: null,
    recommended_strategy: 'copy',
    can_stream_from_source: true,
  },
  folders: [],
  primary_folder_id: null,
  thumbnail_url: '/thumbnails/asset-1.jpg',
}

const noop = () => {}

const t = {
  filters: { audio: 'Audio' },
  badges: {
    ready: 'Ready',
    needsEncoding: 'Needs encoding',
    bitrateOk: 'Bitrate OK',
    bitrateCheck: 'Check bitrate',
    copyMode: 'Copy mode',
    optimizeQueued: 'Optimization queued',
    optimizeFailed: 'Optimization failed',
  },
  messages: { incompatibleSummary: 'Needs attention' },
  details: { hide: 'Hide details', show: 'Show details' },
  metadata: {
    video: 'Video',
    audio: 'Audio',
    channels: (count: number) => `${count}ch`,
  },
  recommendations: ({ label, details }: { label: string; details: string }) => `${label} ${details}`,
  selection: { checkboxLabel: 'Select asset' },
  previewAlt: ({ filename }: { filename: string }) => `Preview of ${filename}`,
}

describe('AssetCard thumbnails', () => {
  it('renders thumbnail preview when thumbnail_url is available', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
        <AssetCard
          asset={baseAsset}
          isSelected={false}
          onSelect={noop}
          onRename={noop}
          onDelete={noop}
          onCheck={noop}
          onMove={noop}
          onDownload={noop}
          onPlaylistAdd={noop}
          onOptimize={noop}
          onDragStart={noop}
          onDragEnd={noop}
          isDeleting={false}
          isChecking={false}
          isGeneratingDownload={false}
          formatWarningMessage={() => 'warning'}
          formatUsageLabel={() => null}
          t={t}
        />
      </NextIntlClientProvider>,
    )

    await waitFor(() => {
      const image = screen.getByAltText(t.previewAlt({ filename: baseAsset.filename })) as HTMLImageElement
      expect(image).toBeInTheDocument()
      expect(new URL(image.src).pathname).toBe('/thumbnails/asset-1.jpg')
    })
  })

  it('falls back when optimization payload is missing', async () => {
    const legacyAsset = {
      ...baseAsset,
      optimization: undefined,
    } as unknown as Asset

    render(
      <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
        <AssetCard
          asset={legacyAsset}
          isSelected={false}
          onSelect={noop}
          onRename={noop}
          onDelete={noop}
          onCheck={noop}
          onMove={noop}
          onDownload={noop}
          onPlaylistAdd={noop}
          onOptimize={noop}
          onDragStart={noop}
          onDragEnd={noop}
          isDeleting={false}
          isChecking={false}
          isGeneratingDownload={false}
          formatWarningMessage={() => 'warning'}
          formatUsageLabel={() => null}
          t={t}
        />
      </NextIntlClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText(baseAsset.filename)).toBeInTheDocument()
    })
  })
})
