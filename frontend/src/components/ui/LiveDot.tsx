import { cn } from '@/lib/utils'

export function LiveDot({ className }: { className?: string }) {
  return <span className={cn('live-dot', className)} aria-hidden="true" />
}
