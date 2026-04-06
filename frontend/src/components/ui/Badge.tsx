import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('badge', {
  variants: {
    variant: {
      success: 'badge-live',
      error: 'badge-error',
      warning: 'badge-warn',
      info: 'badge-indigo',
      secondary: 'badge-idle',
      live: 'badge-live',
      idle: 'badge-idle',
      warn: 'badge-warn',
      indigo: 'badge-indigo',
    },
  },
  defaultVariants: {
    variant: 'secondary',
  },
})

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
