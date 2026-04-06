'use client'

import { cn } from '@/lib/utils'
import { ProgressBar } from './ProgressBar'

interface ProgressProps {
  value: number
  className?: string
  indicatorClassName?: string
}

export function Progress({ value, className, indicatorClassName }: ProgressProps) {
  return <ProgressBar value={value} className={cn(className)} indicatorClassName={indicatorClassName} />
}
