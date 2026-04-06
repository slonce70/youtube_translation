'use client'

import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  description?: React.ReactNode
  className?: string
}

export function Toggle({ checked, onChange, label, description, className }: ToggleProps) {
  return (
    <label className={cn('toggle-wrap', className)}>
      <button
        type="button"
        className={cn('toggle', checked && 'on')}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
      />
      {(label || description) && (
        <span>
          {label ? <span className="toggle-label">{label}</span> : null}
          {description ? <span className="toggle-description">{description}</span> : null}
        </span>
      )}
    </label>
  )
}
