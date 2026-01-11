'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import type { Asset } from '@/lib/types'

type TimelineItem = {
  id: string
  asset: Asset
}

type TimelineEditorProps = {
  videoItems: TimelineItem[]
  audioItems: TimelineItem[]
  onReorder: (target: 'video' | 'audio', fromIndex: number, toIndex: number) => void
  t: (key: string) => string
}

type TimelineLaneProps = {
  label: string
  items: TimelineItem[]
  target: 'video' | 'audio'
  onReorder: TimelineEditorProps['onReorder']
  emptyLabel: string
}

const TimelineLane = ({ label, items, target, onReorder, emptyLabel }: TimelineLaneProps) => (
  <div className="rounded-lg border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{label}</h4>
    {items.length === 0 ? (
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{emptyLabel}</p>
    ) : (
      <ul className="mt-3 space-y-2">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
          >
            <span className="truncate text-slate-800 dark:text-slate-100">{item.asset.filename}</span>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onReorder(target, index, index - 1)}
                disabled={index === 0}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onReorder(target, index, index + 1)}
                disabled={index === items.length - 1}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
)

export const TimelineEditor = ({ videoItems, audioItems, onReorder, t }: TimelineEditorProps) => {
  const emptyLabel = t('streams.builder.timeline.emptyLane')

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TimelineLane
        label={t('streams.builder.timeline.videoLane')}
        items={videoItems}
        target="video"
        onReorder={onReorder}
        emptyLabel={emptyLabel}
      />
      <TimelineLane
        label={t('streams.builder.timeline.audioLane')}
        items={audioItems}
        target="audio"
        onReorder={onReorder}
        emptyLabel={emptyLabel}
      />
    </div>
  )
}
