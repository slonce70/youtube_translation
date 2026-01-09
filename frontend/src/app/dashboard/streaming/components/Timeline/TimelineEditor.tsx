/* eslint-disable i18next/no-literal-string */
import React, { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Asset } from '@/lib/types'
import { Clock, GripVertical, Film, Music } from 'lucide-react'

interface TimelineItem {
  id: string
  asset: Asset
  duration: number
  startTime: number
}

interface TimelineTrackProps {
  title: string
  target: 'video' | 'audio'
  icon: React.ReactNode
  items: TimelineItem[]
  pixelsPerSecond: number
  totalDuration: number
  colorClass: string
  onDragStart: (target: 'video' | 'audio', index: number) => void
  onDrop: (target: 'video' | 'audio', index: number) => void
}

const TimelineClip = ({ 
  item, 
  index, 
  pixelsPerSecond, 
  colorClass,
  onDragStart,
  onDrop 
}: { 
  item: TimelineItem; 
  index: number;
  pixelsPerSecond: number; 
  colorClass: string;
  onDragStart: () => void;
  onDrop: () => void;
}) => {
  const width = item.duration * pixelsPerSecond
  const left = item.startTime * pixelsPerSecond

  return (
    <div
      className={cn(
        'absolute top-1 bottom-1 rounded-md border border-white/20 shadow-sm flex items-center px-2 overflow-hidden group cursor-grab active:cursor-grabbing hover:brightness-110 transition-all',
        colorClass
      )}
      style={{
        left: `${left}px`,
        width: `${Math.max(width, 24)}px`, // Min width for visibility
      }}
      title={`${item.asset.filename} (${item.duration.toFixed(1)}s)`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDrop()
      }}
    >
      <div className="flex items-center gap-2 min-w-0 w-full pointer-events-none">
        <GripVertical className="h-3 w-3 opacity-50 group-hover:opacity-100 shrink-0" />
        <span className="truncate text-xs font-medium text-white/90">{item.asset.filename}</span>
      </div>
    </div>
  )
}

const TimelineTrack = ({ title, target, icon, items, pixelsPerSecond, totalDuration, colorClass, onDragStart, onDrop }: TimelineTrackProps) => {
  const trackWidth = totalDuration * pixelsPerSecond

  return (
    <div className="flex h-24 border-b border-slate-200 dark:border-slate-700">
      {/* Track Header */}
      <div className="w-32 shrink-0 border-r border-slate-200 bg-slate-50 p-3 flex flex-col justify-center dark:border-slate-700 dark:bg-slate-800/50 z-10">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-medium text-sm">
          {icon}
          <span>{title}</span>
        </div>
      </div>

      {/* Track Content */}
      <div 
        className="relative flex-1 bg-slate-100/50 dark:bg-slate-900/20 overflow-hidden"
        onDragOver={(e) => e.preventDefault()}
      >
        <div style={{ width: `${trackWidth}px`, height: '100%' }} className="relative">
          {items.map((item, index) => (
            <TimelineClip 
              key={item.id} 
              item={item} 
              index={index}
              pixelsPerSecond={pixelsPerSecond} 
              colorClass={colorClass} 
              onDragStart={() => onDragStart(target, index)}
              onDrop={() => onDrop(target, index)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

const TimelineRuler = ({ duration, pixelsPerSecond }: { duration: number; pixelsPerSecond: number }) => {
  const markers = []
  const interval = 10 // seconds per major marker
  
  for (let i = 0; i <= duration; i += interval) {
    markers.push(i)
  }

  return (
    <div className="flex h-8 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
       <div className="w-32 shrink-0 border-r border-slate-200 dark:border-slate-700" /> {/* Header spacer */}
       <div className="relative flex-1 overflow-hidden">
         <div style={{ width: `${duration * pixelsPerSecond}px` }} className="h-full relative">
           {markers.map((time) => (
             <div
               key={time}
               className="absolute top-0 bottom-0 border-l border-slate-300 dark:border-slate-600 pl-1 text-[10px] text-slate-500 select-none"
               style={{ left: `${time * pixelsPerSecond}px` }}
             >
               {new Date(time * 1000).toISOString().substr(14, 5)}
             </div>
           ))}
         </div>
       </div>
    </div>
  )
}

interface TimelineEditorProps {
  videoItems: { id: string; asset: Asset }[]
  audioItems: { id: string; asset: Asset }[]
  onReorder?: (target: 'video' | 'audio', fromIndex: number, toIndex: number) => void
}

export function TimelineEditor({ videoItems, audioItems, onReorder }: TimelineEditorProps) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(20)
  const dragItemRef = useRef<{ target: 'video' | 'audio'; index: number } | null>(null)
  
  // Calculate layout
  const processItems = (items: { id: string; asset: Asset }[]): TimelineItem[] => {
    let currentTime = 0
    return items.map((item) => {
      const duration = item.asset.duration_seconds || 10 // Default 10s if unknown
      const timelineItem = {
        id: item.id,
        asset: item.asset,
        duration,
        startTime: currentTime,
      }
      currentTime += duration
      return timelineItem
    })
  }

  const videoTimelineItems = processItems(videoItems)
  const audioTimelineItems = processItems(audioItems)

  const videoDuration = videoTimelineItems.reduce((acc, item) => acc + item.duration, 0)
  const audioDuration = audioTimelineItems.reduce((acc, item) => acc + item.duration, 0)
  const totalDuration = Math.max(videoDuration, audioDuration, 60) // Min 1 min for visibility

  const handleDragStart = (target: 'video' | 'audio', index: number) => {
    dragItemRef.current = { target, index }
  }

  const handleDrop = (target: 'video' | 'audio', toIndex: number) => {
    const dragged = dragItemRef.current
    if (!dragged || !onReorder) return
    
    if (dragged.target === target && dragged.index !== toIndex) {
      onReorder(target, dragged.index, toIndex)
    }
    dragItemRef.current = null
  }

  return (
    <div className="border rounded-lg border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 overflow-hidden flex flex-col select-none">
      <div className="p-2 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <Clock className="h-3 w-3" />
          Total Duration: {new Date(Math.max(videoDuration, audioDuration) * 1000).toISOString().substr(11, 8)}
        </div>
        <div className="flex items-center gap-2">
           <button 
             onClick={() => setPixelsPerSecond(p => Math.max(5, p - 5))}
             className="px-2 py-1 text-xs border rounded hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
           >
             - Zoom
           </button>
           <button 
             onClick={() => setPixelsPerSecond(p => Math.min(100, p + 5))}
             className="px-2 py-1 text-xs border rounded hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
           >
             + Zoom
           </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: '100%', width: 'max-content' }}>
          <TimelineRuler duration={totalDuration} pixelsPerSecond={pixelsPerSecond} />
          
          <TimelineTrack 
            title="Video" 
            target="video"
            icon={<Film className="h-4 w-4" />} 
            items={videoTimelineItems} 
            pixelsPerSecond={pixelsPerSecond}
            totalDuration={totalDuration}
            colorClass="bg-blue-500 dark:bg-blue-600 text-white"
            onDragStart={handleDragStart}
            onDrop={handleDrop}
          />
          
          <TimelineTrack 
            title="Audio" 
            target="audio"
            icon={<Music className="h-4 w-4" />} 
            items={audioTimelineItems} 
            pixelsPerSecond={pixelsPerSecond}
            totalDuration={totalDuration}
            colorClass="bg-emerald-500 dark:bg-emerald-600 text-white"
            onDragStart={handleDragStart}
            onDrop={handleDrop}
          />
        </div>
      </div>
    </div>
  )
}

