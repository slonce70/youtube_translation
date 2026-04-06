import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

const buttonVariants = cva('btn', {
  variants: {
    variant: {
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      success: 'btn-green',
      danger: 'btn-danger',
      ghost: 'btn-ghost',
      outline: 'btn-outline',
      destructive: 'btn-danger',
      error: 'btn-danger',
    },
    size: {
      sm: 'btn-sm',
      md: '',
      lg: 'btn-lg',
      icon: 'btn-icon',
    },
    fullWidth: {
      true: 'btn-full',
      false: '',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'md',
    fullWidth: false,
  },
})

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean
  loadingText?: string
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, isLoading, loadingText, children, disabled, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        ref={ref}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isLoading && loadingText ? loadingText : children}
      </button>
    )
  },
)

Button.displayName = 'Button'

export { Button, buttonVariants }
