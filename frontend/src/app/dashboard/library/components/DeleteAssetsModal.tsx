'use client'

import { AlertCircle, X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import type { Asset, AssetUsageReference } from '@/lib/types'

import { ForceUsageList } from './ForceUsageList'

type DeleteModalState = {
  open: boolean
  assetIds: string[]
  forceRequired: boolean
  forceTarget?: {
    assetId: string
    name?: string
    usage?: Asset['usage']
  }
}

type DeleteAssetsModalProps = {
  closeLabel: string
  collectionDeleteLabel: string
  collectionsHint: string
  deleteConfirmLabel: string
  deleteDescription: string
  deleteTitle: string
  deleteUsageWarning: string
  deleteModalAssets: Asset[]
  deleteSelectionHasUsage: boolean
  playlistDeleteLabel: string
  deleteStreamLabel: string
  forceDescription: string
  forceTargetUsage?: Asset['usage']
  forceTitle: string
  forceUnknownLabel: string
  formatCollectionContext: (context?: string | null) => string | null
  formatStatus: (status?: string | null) => string
  formatUsageLabel: (
    type: 'streams' | 'collections' | 'playlists',
    count: number,
  ) => string | null
  isDeletingSelection: boolean
  onClose: () => void
  onConfirmDelete: () => void
  onDeleteCollection: (item: AssetUsageReference) => void
  onDeletePlaylist: (item: AssetUsageReference) => void
  onDeleteStream: (item: AssetUsageReference) => void
  open: boolean
  pendingUsageActionKeys: Set<string>
  selectionForceUsageCollectionsLabel: string
  selectionForceUsagePlaylistsLabel: string
  selectionForceUsageStreamsLabel: string
  selectionUsagePillLabel: (count: number) => string
  selectionUsageNoneLabel: string
  state: DeleteModalState
}

export function DeleteAssetsModal({
  closeLabel,
  collectionDeleteLabel,
  collectionsHint,
  deleteConfirmLabel,
  deleteDescription,
  deleteUsageWarning,
  deleteModalAssets,
  deleteSelectionHasUsage,
  playlistDeleteLabel,
  deleteStreamLabel,
  forceDescription,
  forceTargetUsage,
  forceTitle,
  forceUnknownLabel,
  formatCollectionContext,
  formatStatus,
  formatUsageLabel,
  isDeletingSelection,
  onClose,
  onConfirmDelete,
  onDeleteCollection,
  onDeletePlaylist,
  onDeleteStream,
  open,
  pendingUsageActionKeys,
  selectionForceUsageCollectionsLabel,
  selectionForceUsagePlaylistsLabel,
  selectionForceUsageStreamsLabel,
  selectionUsageNoneLabel,
  selectionUsagePillLabel,
  state,
  deleteTitle,
}: DeleteAssetsModalProps) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 px-4 py-6">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              {deleteTitle}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {deleteDescription}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {deleteSelectionHasUsage && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p>{deleteUsageWarning}</p>
          </div>
        )}

        {state.forceRequired && (
          <div className="mt-4 space-y-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-400/60 dark:bg-rose-500/10 dark:text-rose-100">
            <div>
              <p className="font-semibold">{forceTitle}</p>
              <p className="mt-1 text-slate-600 dark:text-slate-300">
                {forceDescription}
              </p>
            </div>
            <div className="space-y-3">
              <ForceUsageList
                actionLabel={deleteStreamLabel}
                actionPendingKeyPrefix="stream"
                confirmDelete={onDeleteStream}
                formatCollectionContext={formatCollectionContext}
                formatStatus={formatStatus}
                items={forceTargetUsage?.streams}
                label="streams"
                pendingUsageActionKeys={pendingUsageActionKeys}
                selectionCollectionsHint={collectionsHint}
                selectionForceUnknown={forceUnknownLabel}
                selectionForceUsageLabel={selectionForceUsageStreamsLabel}
              />
              <ForceUsageList
                actionLabel={collectionDeleteLabel}
                actionPendingKeyPrefix="collection"
                confirmDelete={onDeleteCollection}
                formatCollectionContext={formatCollectionContext}
                formatStatus={formatStatus}
                items={forceTargetUsage?.collections}
                label="collections"
                pendingUsageActionKeys={pendingUsageActionKeys}
                selectionCollectionsHint={collectionsHint}
                selectionForceUnknown={forceUnknownLabel}
                selectionForceUsageLabel={selectionForceUsageCollectionsLabel}
              />
              <ForceUsageList
                actionLabel={playlistDeleteLabel}
                actionPendingKeyPrefix="playlist"
                formatCollectionContext={formatCollectionContext}
                formatStatus={formatStatus}
                confirmDelete={onDeletePlaylist}
                items={forceTargetUsage?.playlists}
                label="playlists"
                pendingUsageActionKeys={pendingUsageActionKeys}
                selectionCollectionsHint={collectionsHint}
                selectionForceUnknown={forceUnknownLabel}
                selectionForceUsageLabel={selectionForceUsagePlaylistsLabel}
              />
            </div>
          </div>
        )}

        <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">
          {deleteModalAssets.map((asset) => {
            const usage = asset.usage
            const playlistsCount = usage?.playlists?.length ?? 0
            const collectionsCount = usage?.collections?.length ?? 0
            const streamsCount = usage?.streams?.length ?? 0
            const totalUsage = playlistsCount + collectionsCount + streamsCount
            const usageBadges = [
              formatUsageLabel('streams', streamsCount),
              formatUsageLabel('collections', collectionsCount),
              formatUsageLabel('playlists', playlistsCount),
            ].filter(Boolean)

            return (
              <div
                key={`delete-${asset.id}`}
                className={`rounded-lg border px-4 py-3 ${
                  state.forceTarget?.assetId === asset.id
                    ? 'border-amber-400 bg-amber-50/60 dark:border-amber-400/60 dark:bg-amber-500/10'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h4 className="truncate text-sm font-medium text-slate-900 dark:text-white">
                    {asset.filename}
                  </h4>
                  {totalUsage > 0 ? (
                    <Badge variant="warning">
                      {selectionUsagePillLabel(totalUsage)}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-300">
                  {usageBadges.length > 0 ? (
                    usageBadges.map((label, index) => (
                      <span
                        key={`${asset.id}-usage-${index}`}
                        className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800/60"
                      >
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500">
                      {selectionUsageNoneLabel}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            {closeLabel}
          </Button>
          <Button
            variant="danger"
            onClick={onConfirmDelete}
            isLoading={isDeletingSelection}
            disabled={state.forceRequired}
          >
            {deleteConfirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
