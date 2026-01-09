import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Stream } from '@/lib/types'
import { api } from '@/lib/api'

const RECONNECT_DELAY = 3000

export function useStreamSocket(userId?: string) {
  const queryClient = useQueryClient()
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!userId) return
    if (process.env.NODE_ENV === 'test') return

    const connect = async () => {
      if (typeof window === 'undefined') return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.host
      let wsToken: string | null = null
      try {
        const response = await api.streams.createWsToken()
        wsToken = response.token
      } catch (error) {
        console.warn('[ws] Failed to fetch WebSocket token', error)
        reconnectTimeoutRef.current = setTimeout(() => {
          void connect()
        }, RECONNECT_DELAY)
        return
      }

      // Adjust path if running behind a proxy or directly
      const wsUrl = `${protocol}//${host}/api/streams/ws/status`

      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('Stream WebSocket connected')
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
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
                  // Update runtime status based on WS data
                  // If WS says it's running, set to 'running'
                  // If WS has no info but DB said 'running', it might have stopped or WS is partial
                  // For now, let's just update if we have data
                  return {
                    ...stream,
                    status: update.is_running ? 'running' : (stream.status === 'running' ? 'stopped' : stream.status),
                    uptime_seconds: update.uptime_seconds ?? stream.uptime_seconds,
                    started_at: update.started_at ?? stream.started_at,
                  }
                }
                // If stream is running in DB but missing from active_streams, it likely stopped
                if (stream.status === 'running' && !activeStreamsMap[stream.id]) {
                   return { ...stream, status: 'stopped' }
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
        socketRef.current = null
        // Attempt reconnect
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, RECONNECT_DELAY)
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        ws.close()
      }

      socketRef.current = ws
    }

    void connect()

    return () => {
      if (socketRef.current) {
        socketRef.current.close()
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [userId, queryClient])

  return socketRef.current?.readyState === WebSocket.OPEN
}
