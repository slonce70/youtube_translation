'use client'

import { useEffect } from 'react'

// Track 5b/D / RULE 16 (part 2): swap the document <link rel="icon"> based
// on the most-severe stream state across the operator's streams. Together
// with useStreamTabTitle this turns the pinned tab itself into the
// monitoring surface — the operator sees green/amber/red on the favicon
// without having to focus the window.

type StreamHealth = 'live' | 'degraded' | 'down' | 'idle' | 'unknown'

const FAVICON_HREF: Partial<Record<StreamHealth, string>> = {
  live: '/favicon-live.svg',
  degraded: '/favicon-degraded.svg',
  down: '/favicon-down.svg',
}

const DEFAULT_FAVICON = '/favicon.ico'

function resolveLink(): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  return link
}

/**
 * Sets the favicon to the colour matching `health` while the hook is
 * mounted. Restores the previous favicon on unmount.
 */
export function useStreamFavicon(health: StreamHealth): void {
  useEffect(() => {
    const link = resolveLink()
    if (!link) return
    const previous = link.getAttribute('href')
    const previousType = link.getAttribute('type')
    const next = FAVICON_HREF[health]
    if (next) {
      link.setAttribute('type', 'image/svg+xml')
      link.setAttribute('href', next)
    } else {
      link.removeAttribute('type')
      link.setAttribute('href', DEFAULT_FAVICON)
    }
    return () => {
      if (previous != null) link.setAttribute('href', previous)
      else link.removeAttribute('href')
      if (previousType != null) link.setAttribute('type', previousType)
      else link.removeAttribute('type')
    }
  }, [health])
}
