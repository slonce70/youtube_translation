'use client'

import { toast } from 'sonner'

interface CopyFieldProps {
  value: string
  copyLabel?: string
  copiedMessage?: string
}

export function CopyField({
  value,
  copyLabel = 'Copy',
  copiedMessage = 'Copied to clipboard',
}: CopyFieldProps) {
  return (
    <div className="copy-field">
      <div className="copy-field-val" title={value}>{value}</div>
      <button
        type="button"
        className="copy-btn-inline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            toast.success(copiedMessage)
          } catch {
            toast.error('Copy failed')
          }
        }}
      >
        {copyLabel}
      </button>
    </div>
  )
}
