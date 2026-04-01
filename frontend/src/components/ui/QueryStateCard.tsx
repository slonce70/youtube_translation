'use client'

import { AlertCircle } from 'lucide-react'

import { Button } from './Button'
import { Card, CardContent } from './Card'
import { cn } from '@/lib/utils'

type QueryStateCardProps = {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function QueryStateCard({
  title,
  description,
  actionLabel,
  onAction,
  className,
}: QueryStateCardProps) {
  return (
    <Card className={cn('border-error-200/70 bg-error-50/80 dark:border-error-500/30 dark:bg-error-950/20', className)}>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error-100 text-error-600 dark:bg-error-500/10 dark:text-error-300">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-error-900 dark:text-error-100">{title}</p>
            <p className="text-sm leading-6 text-error-800/80 dark:text-error-100/75">{description}</p>
          </div>
        </div>

        {actionLabel && onAction ? (
          <Button variant="secondary" size="sm" onClick={onAction} className="shrink-0">
            {actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
