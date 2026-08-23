/**
 * useWebSocket - Generic WebSocket connection hook
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Connection state tracking
 * - Message queuing during disconnection
 * - Clean teardown on unmount
 * - Type-safe message handling
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { enqueueError } from '@/src/lib/sentry/sentryClient'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface WebSocketConfig {
  /** WebSocket URL */
  url: string
  /** Reconnection strategy */
  reconnect?: boolean
  /** Maximum reconnection attempts (0 = infinite) */
  maxReconnectAttempts?: number
  /** Initial reconnection delay in ms */
  reconnectDelayMs?: number
  /** Maximum reconnection delay in ms */
  maxReconnectDelayMs?: number
  /** Protocols to use */
  protocols?: string | string[]
}

export interface UseWebSocketReturn<T> { // eslint-disable-line @typescript-eslint/no-unused-vars
  /** Current connection state */
  state: ConnectionState
  /** Send a message (queued if disconnected) */
  send: (message: string | object) => void
  /** Manually close connection */
  close: () => void
  /** Manually reconnect */
  reconnect: () => void
  /** Last error */
  error: Event | null
  /** Number of reconnection attempts */
  reconnectAttempts: number
}

export function useWebSocket<T = unknown>(
  config: WebSocketConfig,
  onMessage: (data: T) => void
): UseWebSocketReturn<T> {
  const {
    url,
    reconnect = true,
    maxReconnectAttempts = 5,
    reconnectDelayMs = 1000,
    maxReconnectDelayMs = 30000,
    protocols,
  } = config

  const [state, setState] = useState<ConnectionState>('connecting')
  const [error, setError] = useState<Event | null>(null)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const messageQueueRef = useRef<string[]>([])
  const isMountedRef = useRef(true)
  const isManualCloseRef = useRef(false)
  const connectionReadyRef = useRef(false) // Dedup flag to prevent multiple onopen events

  // Calculate exponential backoff delay
  const getReconnectDelay = useCallback((attempt: number): number => {
    const delay = reconnectDelayMs * Math.pow(2, attempt)
    return Math.min(delay, maxReconnectDelayMs)
  }, [reconnectDelayMs, maxReconnectDelayMs])

  // Create WebSocket connection
  const connect = useCallback(() => {
    if (!isMountedRef.current) return

    try {
      setState('connecting')
      setError(null)

      const ws = protocols 
        ? new WebSocket(url, protocols)
        : new WebSocket(url)

      ws.onopen = () => {
        if (!isMountedRef.current) return
        
        // Dedup: ignore duplicate onopen events (e.g., Firefox browser retry logic)
        // Set flag on first onopen, subsequent onopen events are ignored
        if (connectionReadyRef.current === true) {
          console.warn('[useWebSocket] Ignoring duplicate onopen event')
          return
        }
        
        connectionReadyRef.current = true
        setState('connected')
        setReconnectAttempts(0)

        // Send any queued messages
        while (messageQueueRef.current.length > 0) {
          const message = messageQueueRef.current.shift()
          if (message) ws.send(message)
        }
      }

      ws.onmessage = (event: MessageEvent) => {
        if (!isMountedRef.current) return

        try {
          const data = typeof event.data === 'string' 
            ? JSON.parse(event.data) 
            : event.data
          onMessage(data as T)
        } catch (err) {
          console.error('[useWebSocket] Failed to parse message:', err)
        }
      }

      ws.onerror = (event: Event) => {
        if (!isMountedRef.current) return
        
        setState('error')
        setError(event)
        console.error('[useWebSocket] Connection error:', event)
        void enqueueError(new Error(`WebSocket connection error: ${url}`), {
          component: 'useWebSocket',
          tags: { transport: 'websocket' },
          extra: { url, type: event.type },
        })
      }

      ws.onclose = () => {
        if (!isMountedRef.current || isManualCloseRef.current) {
          setState('disconnected')
          connectionReadyRef.current = false
          return
        }

        connectionReadyRef.current = false
        setState('disconnected')

        // Attempt reconnection if enabled
        if (reconnect) {
          const attempts = reconnectAttempts + 1
          
          if (maxReconnectAttempts === 0 || attempts <= maxReconnectAttempts) {
            const delay = getReconnectDelay(attempts)
            
            console.log(
              `[useWebSocket] Reconnecting in ${delay}ms (attempt ${attempts})`
            )
            
            setReconnectAttempts(attempts)
            
            reconnectTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current) {
                connect()
              }
            }, delay)
          } else {
            console.error(
              `[useWebSocket] Max reconnection attempts (${maxReconnectAttempts}) reached`
            )
            void enqueueError(new Error(`WebSocket connection dropped: ${url}`), {
              component: 'useWebSocket',
              tags: { transport: 'websocket' },
              extra: { url, reconnectAttempts: attempts },
            })
          }
        }
      }

      wsRef.current = ws
    } catch (err) {
      console.error('[useWebSocket] Failed to create connection:', err)
      void enqueueError(err, {
        component: 'useWebSocket',
        tags: { transport: 'websocket' },
        extra: { url },
      })
      setState('error')
    }
  }, [url, protocols, reconnect, maxReconnectAttempts, getReconnectDelay, reconnectAttempts, onMessage])

  // Send message
  const send = useCallback((message: string | object) => {
    const payload = typeof message === 'string' ? message : JSON.stringify(message)

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(payload)
    } else {
      // Queue message if not connected
      messageQueueRef.current.push(payload)
    }
  }, [])

  // Close connection
  const closeConnection = useCallback(() => {
    isManualCloseRef.current = true
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setState('disconnected')
    messageQueueRef.current = []
  }, [])

  // Manual reconnect
  const manualReconnect = useCallback(() => {
    isManualCloseRef.current = false
    setReconnectAttempts(0)
    closeConnection()
    connect()
  }, [connect, closeConnection])

  // Initial connection
  useEffect(() => {
    connect()

    return () => {
      isMountedRef.current = false
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  return {
    state,
    send,
    close: closeConnection,
    reconnect: manualReconnect,
    error,
    reconnectAttempts,
  }
}
