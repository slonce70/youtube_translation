'use client'

import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number
  className?: string
  indicatorClassName?: string
}

export function Progress({ value, className, indicatorClassName }: ProgressProps) {
  const clamped = Math.min(Math.max(value, 0), 100)

  return (
    <div
      className={cn(
        'w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden',
        className
      )}
    >
      <div
        className={cn('h-full bg-primary-500 transition-all duration-300', indicatorClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

