'use client'

import { Toaster as Sonner } from 'sonner'

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      expand={false}
      closeButton
      toastOptions={{
        className: 'dashboard-toast',
        style: {
          background: '#1e2639',
          color: '#e2e8f0',
          border: '1px solid #3d4a6b',
          borderRadius: '10px',
          boxShadow: '0 4px 24px rgba(0,0,0,.4)',
        },
      }}
    />
  )
}
