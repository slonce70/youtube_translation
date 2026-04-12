'use client'

import { Button } from '@/components/ui/Button'
import type { AssetUsageReference } from '@/lib/types'

type ForceUsageListProps = {
  actionLabel: string
  actionPendingKeyPrefix: 'stream' | 'collection' | 'playlist'
  confirmDelete?: (item: AssetUsageReference) => void
  formatCollectionContext: (context?: string | null) => string | null
  formatStatus: (status?: string | null) => string
  items?: AssetUsageReference[]
  label: 'streams' | 'collections' | 'playlists'
  pendingUsageActionKeys: Set<string>
  selectionCollectionsHint: string
  selectionForceUnknown: string
  selectionForceUsageLabel: string
}

export function ForceUsageList({
  actionLabel,
  actionPendingKeyPrefix,
  confirmDelete,
  formatCollectionContext,
  formatStatus,
  items,
  label,
  pendingUsageActionKeys,
  selectionCollectionsHint,
  selectionForceUnknown,
  selectionForceUsageLabel,
}: ForceUsageListProps) {
  if (!items || items.length === 0) {
    return null
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {selectionForceUsageLabel}
      </p>
      {label === 'collections' && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {selectionCollectionsHint}
        </p>
      )}
      <ul className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
        {items.map((item) => (
          <li
            key={`${label}-${item.id}`}
            className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-800/40"
          >
            <span className="truncate">
              {item.name || selectionForceUnknown}
            </span>
            <div className="flex items-center gap-2">
              {label === 'collections' && item.context && (() => {
                const contextLabel = formatCollectionContext(item.context)
                if (!contextLabel) return null
                return (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700/50 dark:text-slate-200">
                    {contextLabel}
                  </span>
                )
              })()}
              {label === 'streams' && item.status ? (
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {formatStatus(item.status)}
                </span>
              ) : null}
              {confirmDelete ? (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  isLoading={pendingUsageActionKeys.has(`${actionPendingKeyPrefix}:${item.id}`)}
                  disabled={
                    label === 'streams'
                      ? item.status === 'running' ||
                        item.status === 'starting' ||
                        item.status === 'stopping'
                      : false
                  }
                  onClick={() => confirmDelete(item)}
                >
                  {actionLabel}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
