import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number
  tone?: 'default' | 'green' | 'amber' | 'red'
  className?: string
  indicatorClassName?: string
}

export function ProgressBar({
  value,
  tone = 'default',
  className,
  indicatorClassName,
}: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), 100)
  const toneClass =
    tone === 'green' ? 'green' : tone === 'amber' ? 'amber' : tone === 'red' ? 'red' : ''

  return (
    <div className={cn('progress-bar', className)}>
      <div
        className={cn('progress-fill', toneClass, indicatorClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
