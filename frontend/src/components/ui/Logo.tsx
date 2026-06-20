import { cn } from '@/lib/utils'

interface LogoMarkProps {
  className?: string
  /** Pixel size of the square mark. */
  size?: number
}

/**
 * Loopcast brand mark: an orbit ring with a luminous core and a single
 * satellite dot. Stroke follows `currentColor`; the core/satellite use the
 * `--logo-accent` CSS variable (falls back to currentColor) so the same mark
 * works on the landing page, the operator console, and on solid backgrounds.
 */
export function LogoMark({ className, size = 28 }: LogoMarkProps) {
  return (
    <svg
      className={cn('shrink-0', className)}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2" opacity="0.85" />
      <circle cx="16" cy="16" r="5" fill="var(--logo-accent, currentColor)" />
      <circle cx="26" cy="6" r="3" fill="var(--logo-accent, currentColor)" />
    </svg>
  )
}

interface LogoProps {
  className?: string
  markClassName?: string
  size?: number
  /** Render the "Loopcast" wordmark next to the mark. */
  showWordmark?: boolean
}

export function Logo({ className, markClassName, size = 28, showWordmark = true }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className={markClassName} size={size} />
      {showWordmark ? <span className="logo-wordmark">{'Loopcast'}</span> : null}
    </span>
  )
}
