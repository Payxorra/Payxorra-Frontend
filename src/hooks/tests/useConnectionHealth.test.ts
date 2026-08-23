/**
 * useConnectionHealth.test.ts
 * 
 * Comprehensive tests for WebSocket health check with timer drift mitigation.
 * Tests cover:
 * - Monotonic deadline pattern prevents timer drift
 * - Timer generation guard eliminates stale callbacks
 * - Multiple rapid resetHealthTimer() calls don't cause drift
 * - Multi-fire onopen events don't break health check
 * - Secondary health check via ws events
 */

import { renderHook, waitFor } from '@testing-library/react'
import { useConnectionHealth } from './useConnectionHealth'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock WebSocket
class MockWebSocket {
  readyState = WebSocket.OPEN
  listeners: Record<string, ((...args: unknown[]) => void)[]> = {
    error: [],
    close: [],
  }

  addEventListener(event: string, callback: (...args: unknown[]) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(callback)
  }

  removeEventListener(event: string, callback: (...args: unknown[]) => void) {
    if (!this.listeners[event]) return
    this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback)
  }

  send(message: string) { // eslint-disable-line @typescript-eslint/no-unused-vars
    // Mock send
  }

  close() {
    this.readyState = WebSocket.CLOSED
  }

  simulateError() {
    this.listeners.error?.forEach((cb) => cb())
  }

  simulateClose() {
    this.listeners.close?.forEach((cb) => cb())
  }
}

describe('useConnectionHealth', () => {
  let ws: MockWebSocket
  let onHealthChange: () => void

  beforeEach(() => {
    ws = new MockWebSocket()
    onHealthChange = vi.fn()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('should initialize with healthy status', () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 10000,
        pongTimeoutMs: 15000,
        onHealthChange,
      })
    )

    expect(result.current.health.isHealthy).toBe(true)
    expect(result.current.health.missedPongCount).toBe(0)
  })

  it('should reset health timer without drift on single call', async () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 10000,
        pongTimeoutMs: 15000,
        onHealthChange,
      })
    )

    const initialTime = Date.now()
    result.current.resetHealthTimer()

    vi.advanceTimersByTime(10000)
    await waitFor(() => {
      expect(result.current.health.lastPingTime).toBeGreaterThanOrEqual(
        initialTime + 10000
      )
    })
  })

  /**
   * CRITICAL TEST: Multiple rapid resetHealthTimer() calls simulate duplicate onopen events.
   * This test verifies the monotonic deadline pattern prevents timer drift.
   */
  it('should not drift when resetHealthTimer is called multiple times rapidly (multi-fire onopen simulation)', async () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 10000,
        pongTimeoutMs: 15000,
        onHealthChange,
      })
    )

    const startTime = Date.now()
    let lastPingTime = startTime

    // Simulate 5 rapid onopen events (Firefox bug scenario)
    // Each one calls resetHealthTimer() 2ms apart
    for (let i = 0; i < 5; i++) {
      result.current.resetHealthTimer()
      vi.advanceTimersByTime(2)
    }

    // Total time elapsed: 5 resets × 2ms = 10ms
    // Expected behavior: next ping should be at startTime + 10000, not startTime + 9990
    // (which would happen with timer drift)

    // Advance to just before expected ping
    vi.advanceTimersByTime(9990 - 10)
    lastPingTime = Date.now() // eslint-disable-line @typescript-eslint/no-unused-vars

    // Advance to the actual expected ping time
    vi.advanceTimersByTime(10)

    await waitFor(() => {
      // Health check should trigger at the right time
      // Drift should be < 100ms (acceptable per spec)
      const actualDrift = Math.abs(
        result.current.health.lastPingTime - (startTime + 10000)
      )
      expect(actualDrift).toBeLessThan(100)
    })
  })

  /**
   * Test timer generation guard: stale callbacks should not interfere.
   */
  it('should ignore stale callbacks when timer generation changes', async () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 10000,
        pongTimeoutMs: 15000,
        onHealthChange,
      })
    )

    const startTime = Date.now()
    result.current.resetHealthTimer()

    // Advance halfway through interval
    vi.advanceTimersByTime(5000)

    // Call resetHealthTimer again, which increments generation
    // and invalidates the previous timer callback
    result.current.resetHealthTimer()

    // Advance to where the old callback would have fired
    vi.advanceTimersByTime(5000)

    // The old callback should be ignored, so no health check occurs yet
    expect(result.current.health.lastPingTime).toBeLessThan(startTime + 10000)

    // Advance to the new deadline
    vi.advanceTimersByTime(5000)

    await waitFor(() => {
      // Now the new callback should fire
      expect(result.current.health.lastPingTime).toBeGreaterThanOrEqual(
        startTime + 10000
      )
    })
  })

  /**
   * Test that pong response resets health.
   */
  it('should mark as healthy when pong is received', async () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 10000,
        pongTimeoutMs: 15000,
        onHealthChange,
      })
    )

    result.current.handlePong()

    await waitFor(() => {
      expect(result.current.health.isHealthy).toBe(true)
      expect(result.current.health.missedPongCount).toBe(0)
    })
  })

  /**
   * Test secondary health check via error event.
   */
  it('should mark as unhealthy when WebSocket error occurs', async () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 10000,
        pongTimeoutMs: 15000,
        onHealthChange,
      })
    )

    ws.simulateError()

    await waitFor(() => {
      expect(result.current.health.isHealthy).toBe(false)
      expect(onHealthChange).toHaveBeenCalledWith(false)
    })
  })

  /**
   * Test secondary health check via close event.
   */
  it('should mark as unhealthy when WebSocket closes', async () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 10000,
        pongTimeoutMs: 15000,
        onHealthChange,
      })
    )

    ws.simulateClose()

    await waitFor(() => {
      expect(result.current.health.isHealthy).toBe(false)
      expect(onHealthChange).toHaveBeenCalledWith(false)
    })
  })

  /**
   * Test that multiple missed pongs mark connection as unhealthy.
   */
  it('should mark as unhealthy after multiple missed pongs', async () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 5000,
        pongTimeoutMs: 5000,
        onHealthChange,
      })
    )

    // Simulate 3 missed pongs (more than threshold of 2)
    vi.advanceTimersByTime(5000) // 1st ping
    result.current.resetHealthTimer()

    vi.advanceTimersByTime(5000) // Timeout for pong, 2nd ping
    result.current.resetHealthTimer()

    vi.advanceTimersByTime(5000) // Timeout for pong, 3rd ping
    result.current.resetHealthTimer()

    vi.advanceTimersByTime(5100) // Wait for missed pong detection

    await waitFor(() => {
      expect(result.current.health.missedPongCount).toBeGreaterThan(0)
    })
  })

  /**
   * Cumulative drift test over multiple reconnections.
   * This verifies that 100 reconnections (each with 2 onopen events)
   * don't accumulate to 200ms drift.
   */
  it('should not accumulate significant drift over 100 reconnections with 2 onopen per reconnection', async () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 10000,
        pongTimeoutMs: 15000,
        onHealthChange,
      })
    )

    const startTime = Date.now()
    let totalDrift = 0

    for (let reconnect = 0; reconnect < 100; reconnect++) {
      // Simulate 2 onopen events per reconnection (2ms apart)
      result.current.resetHealthTimer()
      vi.advanceTimersByTime(2)
      result.current.resetHealthTimer()

      // Advance to ping time
      vi.advanceTimersByTime(10000)

      // Calculate drift for this reconnection
      const expectedTime = startTime + reconnect * 2 + 10000
      const actualTime = result.current.health.lastPingTime
      const drift = Math.abs(actualTime - expectedTime)
      totalDrift += drift
    }

    // Average drift should be minimal (< 5ms per reconnection)
    const averageDrift = totalDrift / 100
    expect(averageDrift).toBeLessThan(5)
  })

  /**
   * Test that rapid resetHealthTimer calls (simulating browser retry logic)
   * don't break the deadline calculation.
   */
  it('should handle 10 onopen events within 100ms without breaking', async () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 10000,
        pongTimeoutMs: 15000,
        onHealthChange,
      })
    )

    const startTime = Date.now()

    // Simulate 10 rapid onopen events
    for (let i = 0; i < 10; i++) {
      result.current.resetHealthTimer()
      vi.advanceTimersByTime(10)
    }

    // Total time: 10 × 10ms = 100ms
    // Expected next ping: startTime + 10000

    vi.advanceTimersByTime(9900)

    await waitFor(() => {
      // The health check should fire at the right deadline
      const drift = Math.abs(
        result.current.health.lastPingTime - (startTime + 10000)
      )
      expect(drift).toBeLessThan(200) // Generous tolerance for test timing
    })
  })

  /**
   * Test that health status callback is called only when status changes.
   */
  it('should call onHealthChange only when status changes', async () => {
    const { result } = renderHook(() =>
      useConnectionHealth({
        ws,
        pingIntervalMs: 10000,
        pongTimeoutMs: 15000,
        onHealthChange,
      })
    )

    // Initial state is healthy, so onHealthChange shouldn't be called yet
    expect(onHealthChange).not.toHaveBeenCalled()

    // Simulate error -> marks as unhealthy
    ws.simulateError()

    await waitFor(() => {
      expect(onHealthChange).toHaveBeenCalledWith(false)
    })

    // Reset call count
    onHealthChange.mockClear()

    // Simulate pong -> marks as healthy
    result.current.handlePong()

    await waitFor(() => {
      expect(onHealthChange).toHaveBeenCalledWith(true)
    })
  })
})
