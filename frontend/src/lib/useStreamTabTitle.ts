'use client'

import { useEffect } from 'react'

// RULE 16: persist stream state into the document title so the operator
// reads "● LIVE · YouTube Streaming" / "● DOWN · YouTube Streaming" in
// the pinned tab bar without having to switch focus.

type StreamHealth = 'live' | 'degraded' | 'down' | 'idle' | 'unknown'

const PREFIX: Record<StreamHealth, string> = {
  live: '● LIVE',
  degraded: '● ALERT',
  down: '● DOWN',
  idle: '○ IDLE',
  unknown: '',
}

/**
 * Sets `document.title` to a state-prefixed string while the hook is
 * mounted. Restores the previous title on unmount.
 */
export function useStreamTabTitle(
  health: StreamHealth,
  baseTitle: string,
): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const previous = document.title
    const prefix = PREFIX[health]
    document.title = prefix ? `${prefix} · ${baseTitle}` : baseTitle
    return () => {
      document.title = previous
    }
  }, [health, baseTitle])
}
