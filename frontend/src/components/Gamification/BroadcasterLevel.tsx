/* eslint-disable i18next/no-literal-string */
import React from 'react'
import { Award, Star, Zap, Trophy, Mic2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Progress } from '@/components/ui/Progress'
import { cn } from '@/lib/utils'

interface BroadcasterLevelProps {
  totalStreamHours: number
  totalAssets: number
}

const LEVELS = [
  { minHours: 0, label: 'On Air Novice', icon: Mic2, color: 'text-slate-500' },
  { minHours: 10, label: 'Rising Streamer', icon: Zap, color: 'text-blue-500' },
  { minHours: 50, label: 'Broadcast Pro', icon: Star, color: 'text-purple-500' },
  { minHours: 100, label: 'Channel Master', icon: Award, color: 'text-amber-500' },
  { minHours: 500, label: 'Legend', icon: Trophy, color: 'text-red-500' },
]

export function BroadcasterLevel({ totalStreamHours, totalAssets }: BroadcasterLevelProps) {
  const currentLevelIndex = LEVELS.reduce((acc, level, index) => {
    return totalStreamHours >= level.minHours ? index : acc
  }, 0)

  const currentLevel = LEVELS[currentLevelIndex]
  const nextLevel = LEVELS[currentLevelIndex + 1]
  
  const progress = nextLevel 
    ? ((totalStreamHours - currentLevel.minHours) / (nextLevel.minHours - currentLevel.minHours)) * 100 
    : 100

  const Icon = currentLevel.icon

  return (
    <Card className="overflow-hidden relative">
      <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
        <Icon className="w-32 h-32" />
      </div>
      
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Icon className={cn("w-5 h-5", currentLevel.color)} />
          <span>Broadcaster Career</span>
        </CardTitle>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between items-end mb-1">
              <h3 className={cn("text-2xl font-bold", currentLevel.color)}>
                {currentLevel.label}
              </h3>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Level {currentLevelIndex + 1}
              </span>
            </div>
            
            <Progress value={Math.min(100, Math.max(0, progress))} className="h-2" />
            
            <div className="flex justify-between mt-1 text-xs text-slate-500">
              <span>{totalStreamHours.toFixed(1)} hrs streamed</span>
              {nextLevel ? (
                <span>Next: {nextLevel.minHours} hrs</span>
              ) : (
                <span>Max Level Reached!</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg text-center">
              <p className="text-xs text-slate-500 uppercase font-semibold">Experience</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{Math.floor(totalStreamHours * 100)} XP</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg text-center">
              <p className="text-xs text-slate-500 uppercase font-semibold">Library</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{totalAssets} Clips</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

