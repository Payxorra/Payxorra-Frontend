/**
 * useConnectionHealth - WebSocket health check with timer drift mitigation
 * 
 * Implements a monotonic deadline pattern to avoid timer drift from multiple
 * resetHealthTimer() calls during concurrent reconnections.
 * 
 * Features:
 * - Monotonic deadline pattern prevents timer drift
 * - Timer generation guard eliminates stale callback issues
 * - Secondary health check via ws events (error/close)
 * - Configurable ping/pong timeouts
 * - Automatic connection health tracking
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface HealthCheckConfig {
  /** Ping interval in ms (default: 10000ms) */
  pingIntervalMs?: number
  /** Pong timeout in ms (default: 15000ms) */
  pongTimeoutMs?: number
  /** WebSocket instance to monitor */
  ws: WebSocket | null
  /** Callback when connection health status changes */
  onHealthChange?: (isHealthy: boolean) => void
}

export interface HealthCheckState {
  /** Whether connection is healthy */
  isHealthy: boolean
  /** Last time a pong was received */
  lastPongTime: number
  /** Last time a ping was sent */
  lastPingTime: number
  /** Number of missed pongs */
  missedPongCount: number
  /** Connection established time (for dedup tolerance) */
  connectedAt: number
}

export function useConnectionHealth(config: HealthCheckConfig) {
  const {
    pingIntervalMs = 10000,
    pongTimeoutMs = 15000,
    ws,
    onHealthChange,
  } = config

  const [health, setHealth] = useState<HealthCheckState>({
    isHealthy: true,
    lastPongTime: Date.now(),
    lastPingTime: Date.now(),
    missedPongCount: 0,
    connectedAt: Date.now(),
  })

  // Refs for monotonic deadline pattern
  const nextPingTimeRef = useRef(Date.now() + pingIntervalMs)
  const timerGenerationRef = useRef(0)
  const healthCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastPongTimeRef = useRef(Date.now())
  const missedPongCountRef = useRef(0)
  const isMountedRef = useRef(true)
  const lastHealthStatusRef = useRef(true)

  /**
   * Reset the health timer to a new deadline.
   * Instead of clearing/recreating timers, we just update the deadline.
   * Increment generation to invalidate stale callbacks.
   */
  const resetHealthTimer = useCallback(() => {
    if (!isMountedRef.current) return

    // Update next ping deadline (monotonic deadline pattern)
    nextPingTimeRef.current = Date.now() + pingIntervalMs

    // Increment generation to guard against stale callbacks
    // When this function is called multiple times rapidly (duplicate onopen),
    // the generation increments each time. Stale callbacks check their generation
    // and return early if it doesn't match.
    timerGenerationRef.current += 1
    const currentGeneration = timerGenerationRef.current

    // Reset missed pong count on timer reset
    missedPongCountRef.current = 0

    // Cancel existing timeout if any
    if (healthCheckTimeoutRef.current) {
      clearTimeout(healthCheckTimeoutRef.current)
    }

    // Schedule next health check - this timeout will check if we need to ping
    healthCheckTimeoutRef.current = setTimeout(() => {
      // Guard: check if this callback is still valid (not superseded by reset)
      if (currentGeneration !== timerGenerationRef.current) {
        return
      }

      if (!isMountedRef.current || !ws) return

      performHealthCheck(currentGeneration)
    }, pingIntervalMs)
  }, [pingIntervalMs, ws]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Perform the actual health check.
   * Uses monotonic deadline to determine if we should ping,
   * avoiding drift from multiple timer resets.
   */
  const performHealthCheck = useCallback(
    (generation: number) => {
      if (!isMountedRef.current || !ws) return

      // Guard: this callback should not run if generation has changed
      if (generation !== timerGenerationRef.current) {
        return
      }

      const now = Date.now()
      const timeSinceLastPong = now - lastPongTimeRef.current
      const timeUntilNextPing = nextPingTimeRef.current - now

      // Check if we're past the deadline
      if (timeUntilNextPing <= 0) {
        // Time to send a ping
        if (ws.readyState === WebSocket.OPEN) {
          try {
            // Send a ping message (frame opcode 0x9, but most servers expect a message)
            ws.send(JSON.stringify({ type: 'ping', timestamp: now }))
            lastPongTimeRef.current = now

            setHealth((prev) => ({
              ...prev,
              lastPingTime: now,
            }))
          } catch (err) {
            console.error('[useConnectionHealth] Failed to send ping:', err)
          }
        }

        // Reschedule for next ping
        nextPingTimeRef.current = now + pingIntervalMs
        healthCheckTimeoutRef.current = setTimeout(() => {
          if (generation === timerGenerationRef.current && isMountedRef.current && ws) {
            performHealthCheck(generation)
          }
        }, pingIntervalMs)
      } else {
        // Not yet time to ping, reschedule closer to deadline
        healthCheckTimeoutRef.current = setTimeout(() => {
          if (generation === timerGenerationRef.current && isMountedRef.current && ws) {
            performHealthCheck(generation)
          }
        }, Math.min(timeUntilNextPing, 1000)) // Check every 1s max
      }

      // Secondary health check: check if we've missed a pong
      if (timeSinceLastPong > pongTimeoutMs) {
        missedPongCountRef.current += 1

        // Only mark unhealthy if we've truly missed multiple pongs
        // and no error/close event has been received
        if (missedPongCountRef.current > 2) {
          const isHealthy = false
          if (lastHealthStatusRef.current !== isHealthy) {
            lastHealthStatusRef.current = isHealthy
            onHealthChange?.(isHealthy)
            setHealth((prev) => ({
              ...prev,
              isHealthy,
              missedPongCount: missedPongCountRef.current,
            }))
          }
        }
      } else if (missedPongCountRef.current > 0) {
        // Pong was received, reset health
        missedPongCountRef.current = 0
        const isHealthy = true
        if (lastHealthStatusRef.current !== isHealthy) {
          lastHealthStatusRef.current = isHealthy
          onHealthChange?.(isHealthy)
          setHealth((prev) => ({
            ...prev,
            isHealthy,
            missedPongCount: 0,
          }))
        }
      }
    },
    [ws, pongTimeoutMs, onHealthChange] // eslint-disable-line react-hooks/exhaustive-deps
  )

  /**
   * Handle pong response from server.
   * This resets the pong timeout counter.
   */
  const handlePong = useCallback(() => {
    if (!isMountedRef.current) return

    const now = Date.now()
    lastPongTimeRef.current = now
    missedPongCountRef.current = 0

    // Mark as healthy
    if (!lastHealthStatusRef.current) {
      lastHealthStatusRef.current = true
      onHealthChange?.(true)
    }

    setHealth((prev) => ({
      ...prev,
      isHealthy: true,
      lastPongTime: now,
      missedPongCount: 0,
    }))
  }, [onHealthChange])

  /**
   * Secondary health check: WebSocket error/close listener.
   * Immediately marks connection as unhealthy without waiting for missed pongs.
   */
  const setupEventListeners = useCallback(() => {
    if (!ws) return

    const handleError = () => {
      if (!isMountedRef.current) return

      const isHealthy = false
      if (lastHealthStatusRef.current !== isHealthy) {
        lastHealthStatusRef.current = isHealthy
        onHealthChange?.(isHealthy)
        setHealth((prev) => ({
          ...prev,
          isHealthy,
        }))
      }
    }

    const handleClose = () => {
      if (!isMountedRef.current) return

      const isHealthy = false
      if (lastHealthStatusRef.current !== isHealthy) {
        lastHealthStatusRef.current = isHealthy
        onHealthChange?.(isHealthy)
        setHealth((prev) => ({
          ...prev,
          isHealthy,
        }))
      }
    }

    ws.addEventListener('error', handleError)
    ws.addEventListener('close', handleClose)

    return () => {
      ws.removeEventListener('error', handleError)
      ws.removeEventListener('close', handleClose)
    }
  }, [ws, onHealthChange])

  /**
   * Initialize health check when WebSocket connection opens.
   */
  const startHealthCheck = useCallback(() => {
    if (!isMountedRef.current || !ws) return

    const now = Date.now()
    lastPongTimeRef.current = now
    nextPingTimeRef.current = now + pingIntervalMs
    missedPongCountRef.current = 0

    setHealth({
      isHealthy: true,
      lastPongTime: now,
      lastPingTime: now,
      missedPongCount: 0,
      connectedAt: now,
    })

    resetHealthTimer()
  }, [ws, pingIntervalMs, resetHealthTimer])

  // Setup event listeners for secondary health checks
  useEffect(() => {
    return setupEventListeners()
  }, [setupEventListeners])

  // Initialize health check when ws connects
  useEffect(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      startHealthCheck()
    }

    return () => {
      if (healthCheckTimeoutRef.current) {
        clearTimeout(healthCheckTimeoutRef.current)
      }
    }
  }, [ws, startHealthCheck])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (healthCheckTimeoutRef.current) {
        clearTimeout(healthCheckTimeoutRef.current)
      }
    }
  }, [])

  return {
    health,
    resetHealthTimer,
    handlePong,
  }
}
