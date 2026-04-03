import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Stream } from '@/lib/types'
import { api } from '@/lib/api'

const RECONNECT_DELAY = 3000
const API_PORT_FALLBACK = '8000'

function resolveWebSocketUrl(): string | null {
  if (typeof window === 'undefined') return null

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const configuredApiUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim()

  if (/^https?:\/\//i.test(configuredApiUrl)) {
    try {
      const apiUrl = new URL(configuredApiUrl)
      apiUrl.protocol = protocol
      apiUrl.pathname = '/api/streams/ws/status'
      apiUrl.search = ''
      apiUrl.hash = ''
      return apiUrl.toString()
    } catch (error) {
      console.warn('[ws] Failed to parse NEXT_PUBLIC_API_URL, falling back to host-based URL', error)
    }
  }

  if (process.env.NODE_ENV === 'development') {
    const hostname = window.location.hostname
    const apiPort = API_PORT_FALLBACK
    return `${protocol}//${hostname}:${apiPort}/api/streams/ws/status`
  }

  return `${protocol}//${window.location.host}/api/streams/ws/status`
}

export function useStreamSocket(userId?: string) {
  const queryClient = useQueryClient()
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectEnabledRef = useRef(false)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!userId) return
    if (process.env.NODE_ENV === 'test') return

    reconnectEnabledRef.current = true

    const clearReconnectTimeout = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }

    const scheduleReconnect = () => {
      if (!reconnectEnabledRef.current) {
        return
      }

      clearReconnectTimeout()
      reconnectTimeoutRef.current = setTimeout(() => {
        if (!reconnectEnabledRef.current) {
          return
        }
        void connect()
      }, RECONNECT_DELAY)
    }

    const connect = async () => {
      if (typeof window === 'undefined' || !reconnectEnabledRef.current) return
      let wsToken: string | null = null
      try {
        const response = await api.streams.createWsToken()
        wsToken = response.token
      } catch (error) {
        console.warn('[ws] Failed to fetch WebSocket token', error)
        scheduleReconnect()
        return
      }

      const wsUrl = resolveWebSocketUrl()
      if (!wsUrl) {
        return
      }

      const ws = new WebSocket(wsUrl)
      socketRef.current = ws

      ws.onopen = () => {
        console.log('Stream WebSocket connected')
        if (!reconnectEnabledRef.current) {
          ws.close()
          return
        }

        clearReconnectTimeout()
        setIsConnected(true)
        if (wsToken) {
          ws.send(JSON.stringify({ type: 'auth', token: wsToken }))
        }
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'stream_update') {
            // Message payload is a dict of stream_id -> info
            // We need to update the streams list in the cache
            const activeStreamsMap = message.payload

            queryClient.setQueryData(['streams', userId], (oldStreams: Stream[] | undefined) => {
              if (!oldStreams) return oldStreams

              return oldStreams.map((stream) => {
                const update = activeStreamsMap[stream.id]
                if (update) {
                  return {
                    ...stream,
                    status: update.is_running ? 'running' : 'stopped',
                    uptime_seconds: update.uptime_seconds ?? stream.uptime_seconds,
                    started_at: update.started_at ?? stream.started_at,
                  }
                }
                return stream
              })
            })
          }
        } catch (err) {
          console.error('Error parsing WS message:', err)
        }
      }

      ws.onclose = () => {
        console.log('Stream WebSocket disconnected')
        setIsConnected(false)
        socketRef.current = null
        scheduleReconnect()
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        ws.close()
      }
    }

    void connect()

    return () => {
      reconnectEnabledRef.current = false
      setIsConnected(false)
      clearReconnectTimeout()
      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }
    }
  }, [userId, queryClient])

  return isConnected
}
