'use client'

import { useEffect, useRef, useState } from 'react'

import { api } from './api'
import type { StreamLiveMetrics, StreamPlaybackInfo } from './types'

// Track 5b/G: WebSocket replacement for 5-second /metrics polling.
// Backend (`/api/streams/ws/status`) now broadcasts a per-user
// snapshot at 1 Hz with both `live_metrics` and `playback` enriched
// from ffmpeg_metrics + hot_swap. Frontend opens one WS per browser
// tab, fans out the snapshot to consumers via the returned record.
//
// Auth: backend issues a short-lived token via POST /api/streams/ws/token.
// We fetch one on mount, send it as the first WS message, then start
// receiving snapshots. Reconnects on close (1.5s backoff).

type StreamSnapshot = {
  is_running?: boolean
  uptime_seconds?: number | null
  started_at?: string | null
  restart_attempts?: number | null
  live_metrics?: StreamLiveMetrics | null
  playback?: StreamPlaybackInfo | null
}

interface UseStreamMetricsSocketOptions {
  enabled?: boolean
}

function resolveWsUrl(path: string): string | null {
  if (typeof window === 'undefined') return null
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${path}`
}

export interface UseStreamMetricsSocketResult {
  snapshots: Record<string, StreamSnapshot>
  connected: boolean
}

export function useStreamMetricsSocket(
  options: UseStreamMetricsSocketOptions = {},
): UseStreamMetricsSocketResult {
  const { enabled = true } = options
  const [snapshots, setSnapshots] = useState<Record<string, StreamSnapshot>>({})
  const [connected, setConnected] = useState(false)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    let cancelled = false

    const open = async () => {
      let token: string
      try {
        const issued = await api.streams.createWsToken()
        token = issued.token
      } catch {
        // If the token endpoint is unavailable we just skip — the page
        // still has the 5s /metrics fallback wired up.
        return
      }
      if (cancelled) return

      const url = resolveWsUrl('/api/streams/ws/status')
      if (!url) return

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.addEventListener('open', () => {
        if (cancelled) {
          ws.close()
          return
        }
        ws.send(JSON.stringify({ token }))
        setConnected(true)
      })

      ws.addEventListener('message', (event) => {
        try {
          const parsed = JSON.parse(event.data)
          if (parsed?.type === 'stream_update' && parsed.payload && typeof parsed.payload === 'object') {
            setSnapshots(parsed.payload as Record<string, StreamSnapshot>)
          }
        } catch {
          /* ignore malformed frames */
        }
      })

      const scheduleReconnect = () => {
        setConnected(false)
        if (cancelled) return
        if (reconnectRef.current) clearTimeout(reconnectRef.current)
        reconnectRef.current = setTimeout(() => {
          if (!cancelled) open()
        }, 1500)
      }

      ws.addEventListener('close', scheduleReconnect)
      ws.addEventListener('error', () => {
        try {
          ws.close()
        } catch {
          /* noop */
        }
      })
    }

    void open()

    return () => {
      cancelled = true
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        try {
          ws.close()
        } catch {
          /* noop */
        }
      }
      setConnected(false)
    }
  }, [enabled])

  return { snapshots, connected }
}
