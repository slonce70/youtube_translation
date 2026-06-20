import type { TranslationValues } from 'next-intl'
import { Film, ListVideo } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import type { Asset, MediaCollection } from '@/lib/types'

import type { CollectionEditorState } from '../builder-helpers'

type Translator = (key: string, values?: TranslationValues) => string

type StreamSourceStepProps = {
  builder: Translator
  sourceTab: 'file' | 'playlist'
  setSourceTab: (tab: 'file' | 'playlist') => void
  videoAssets: Asset[]
  videoEditor: CollectionEditorState
  addAssetToEditor: (target: 'video' | 'audio', assetId: string) => void
  removeAssetFromEditor: (target: 'video' | 'audio', assetId: string) => void
  videoCollections?: MediaCollection[]
  handleSelectCollection: (target: 'video' | 'audio', collectionId: string | 'custom') => void
}

export function StreamSourceStep({
  builder,
  sourceTab,
  setSourceTab,
  videoAssets,
  videoEditor,
  addAssetToEditor,
  removeAssetFromEditor,
  videoCollections,
  handleSelectCollection,
}: StreamSourceStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{builder('stepVideo')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-3)', borderRadius: 8, padding: 4 }}>
          <button
            type="button"
            className={sourceTab === 'file' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
            style={{ flex: 1 }}
            onClick={() => setSourceTab('file')}
          >
            {builder('tabFile')}
          </button>
          <button
            type="button"
            className={sourceTab === 'playlist' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
            style={{ flex: 1 }}
            onClick={() => setSourceTab('playlist')}
          >
            {builder('tabPlaylist')}
          </button>
        </div>

        {sourceTab === 'file' ? (
          <div className="summary-list">
            {videoAssets.length > 0 ? (
              videoAssets.slice(0, 12).map((asset) => {
                const isSelected = videoEditor.items.some((item) => item.asset_id === asset.id)
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={`asset-row${isSelected ? ' active' : ''}`}
                    onClick={() =>
                      isSelected ? removeAssetFromEditor('video', asset.id) : addAssetToEditor('video', asset.id)
                    }
                  >
                    <div className="asset-thumb" aria-hidden="true"><Film className="h-4 w-4" /></div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{asset.filename}</div>
                      <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                        {asset.size_bytes
                          ? `${Math.round(asset.size_bytes / 1024 / 1024)} MB`
                          : builder('fallbackDuration')}{' '}
                        ·{' '}
                        {asset.duration_seconds
                          ? `${Math.floor(asset.duration_seconds / 60)}:${String(Math.floor(asset.duration_seconds % 60)).padStart(2, '0')}`
                          : builder('fallbackDuration')}{' '}
                        · {builder('ready')}
                      </div>
                    </div>
                    {isSelected ? <Badge variant="indigo">{'✓'}</Badge> : null}
                  </button>
                )
              })
            ) : (
              <div className="empty-state" style={{ padding: '24px 12px' }}>
                <div className="empty-icon" aria-hidden="true"><Film className="h-7 w-7" /></div>
                <div className="empty-title">{builder('videosEmptyTitle')}</div>
                <div className="empty-sub">{builder('videosEmptyDescription')}</div>
              </div>
            )}
            <button
              type="button"
              className="drop-overlay"
              style={{ position: 'relative', inset: 'auto', pointerEvents: 'auto', minHeight: 64, margin: 0 }}
              onClick={() => window.location.assign('/dashboard/library?tab=assets')}
            >
              <div className="empty-sub">{builder('uploadNew')}</div>
            </button>
          </div>
        ) : (
          <div className="summary-list">
            {videoCollections && videoCollections.length > 0 ? (
              videoCollections.map((collection) => {
                const isSelected = videoEditor.selectedCollectionId === collection.id && videoEditor.mode === 'existing'
                return (
                  <button
                    key={collection.id}
                    type="button"
                    className={`playlist-row${isSelected ? ' active' : ''}`}
                    onClick={() => handleSelectCollection('video', collection.id)}
                  >
                    <div className="asset-thumb" aria-hidden="true"><ListVideo className="h-4 w-4" /></div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{collection.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                        {builder('playlistItems', { count: collection.items.length })}
                      </div>
                    </div>
                    {isSelected ? <Badge variant="indigo">{builder('selected')}</Badge> : null}
                  </button>
                )
              })
            ) : (
              <div className="empty-state" style={{ padding: '24px 12px' }}>
                <div className="empty-icon" aria-hidden="true"><ListVideo className="h-7 w-7" /></div>
                <div className="empty-title">{builder('playlistsEmptyTitle')}</div>
                <div className="empty-sub">{builder('playlistsEmptyDescription')}</div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
