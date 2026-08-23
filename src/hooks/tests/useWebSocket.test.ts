/**
 * useWebSocket.test.ts
 * 
 * Tests for WebSocket hook with onopen dedup functionality.
 * Verifies that duplicate onopen events (from browser retry logic)
 * are properly handled and don't cause state corruption.
 */

import { renderHook, waitFor } from '@testing-library/react'
import { useWebSocket } from './useWebSocket'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock Sentry
vi.mock('@/src/lib/sentry/sentryClient', () => ({
  enqueueError: vi.fn(),
}))

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url: string
  protocols?: string | string[]

  onopen: ((event: Event) => void) | null = null
  onclose: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
  }

  send(data: string) { // eslint-disable-line @typescript-eslint/no-unused-vars
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new Event('close'))
  }

  // Test helper methods
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  simulateMessage(data: unknown) {
    this.readyState = MockWebSocket.OPEN
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }

  simulateError() {
    this.onerror?.(new Event('error'))
  }
}

// Store original WebSocket
const originalWebSocket = global.WebSocket

describe('useWebSocket', () => {
  let mockWs: MockWebSocket | null = null
  let onMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onMessage = vi.fn()
    mockWs = null

    // Replace global WebSocket with mock
    ;(global as unknown).WebSocket = class extends MockWebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols)
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        mockWs = this
      }
    }
  })

  afterEach(() => {
    ;(global as unknown).WebSocket = originalWebSocket
    vi.clearAllMocks()
  })

  it('should establish connection', async () => {
    const { result } = renderHook(() =>
      useWebSocket(
        {
          url: 'ws://localhost:8080',
          reconnect: false,
        },
        onMessage
      )
    )

    expect(result.current.state).toBe('connecting')

    // Simulate connection open
    mockWs?.simulateOpen()

    await waitFor(() => {
      expect(result.current.state).toBe('connected')
    })
  })

  /**
   * CRITICAL TEST: Multiple onopen events in rapid succession (2ms apart).
   * Verifies the connectionReady dedup flag prevents state corruption
   * and duplicate message queue processing.
   */
  it('should handle multiple onopen events (duplicate onopen dedup test)', async () => {
    const { result } = renderHook(() =>
      useWebSocket(
        {
          url: 'ws://localhost:8080',
          reconnect: false,
        },
        onMessage
      )
    )

    // Queue a message before connection
    result.current.send('test-message')

    expect(result.current.state).toBe('connecting')

    // Simulate first onopen (expected)
    mockWs?.simulateOpen()

    await waitFor(() => {
      expect(result.current.state).toBe('connected')
    })

    // Simulate second onopen 2ms later (Firefox bug scenario)
    // This should be ignored due to connectionReady dedup flag
    mockWs?.simulateOpen()

    // State should remain connected, not corrupted
    await waitFor(() => {
      expect(result.current.state).toBe('connected')
    })

    // Verify onopen only processed once (message queued once, not twice)
    expect(mockWs?.send).toHaveBeenCalledTimes(1)
  })

  /**
   * Test that 5 rapid onopen events (Firefox under poor network)
   * don't cause state issues or duplicate processing.
   */
  it('should handle 5 rapid onopen events without state corruption', async () => {
    const { result } = renderHook(() =>
      useWebSocket(
        {
          url: 'ws://localhost:8080',
          reconnect: false,
        },
        onMessage
      )
    )

    // Queue multiple messages
    result.current.send('msg-1')
    result.current.send('msg-2')

    // Simulate 5 rapid onopen events
    for (let i = 0; i < 5; i++) {
      mockWs?.simulateOpen()
    }

    await waitFor(() => {
      expect(result.current.state).toBe('connected')
    })

    // The queued messages should only be sent once
    // (dedup flag prevents re-processing)
    expect(mockWs?.send).toHaveBeenCalledTimes(2) // 2 queued messages

    // Verify reconnect attempts were reset (healthy connection)
    expect(result.current.reconnectAttempts).toBe(0)
  })

  /**
   * Test that onclose properly resets the dedup flag
   * so that a reconnection can process onopen normally.
   */
  it('should reset dedup flag on close, allowing reconnect to work', async () => {
    const { result } = renderHook(() =>
      useWebSocket(
        {
          url: 'ws://localhost:8080',
          reconnect: true,
          reconnectDelayMs: 100,
          maxReconnectAttempts: 1,
        },
        onMessage
      )
    )

    // First connection
    mockWs?.simulateOpen()

    await waitFor(() => {
      expect(result.current.state).toBe('connected')
    })

    // Close connection
    mockWs?.close()

    await waitFor(() => {
      expect(result.current.state).toBe('disconnected')
    })

    // Wait for reconnect
    vi.useFakeTimers()
    vi.advanceTimersByTime(100)

    // Simulate reconnect with new websocket
    const newMockWs = new MockWebSocket('ws://localhost:8080')
    ;(global as unknown).WebSocket = class {
      constructor() {
        return newMockWs
      }
    }

    // Simulate second connection
    newMockWs.simulateOpen()

    await waitFor(() => {
      expect(result.current.state).toBe('connected')
      expect(result.current.reconnectAttempts).toBe(0)
    })

    vi.useRealTimers()
  })

  it('should queue messages when disconnected', async () => {
    const { result } = renderHook(() =>
      useWebSocket(
        {
          url: 'ws://localhost:8080',
          reconnect: false,
        },
        onMessage
      )
    )

    // Send message while disconnected
    result.current.send('queued-message')

    // State should still be connecting
    expect(result.current.state).toBe('connecting')

    // Now connect
    mockWs?.simulateOpen()

    await waitFor(() => {
      expect(result.current.state).toBe('connected')
    })

    // Queued message should have been sent
    expect(mockWs?.send).toHaveBeenCalledWith(
      JSON.stringify('queued-message')
    )
  })

  it('should handle message reception', async () => {
    const { result } = renderHook(() =>
      useWebSocket(
        {
          url: 'ws://localhost:8080',
          reconnect: false,
        },
        onMessage
      )
    )

    mockWs?.simulateOpen()

    await waitFor(() => {
      expect(result.current.state).toBe('connected')
    })

    // Simulate incoming message
    mockWs?.simulateMessage({ type: 'test', payload: 'data' })

    await waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith({
        type: 'test',
        payload: 'data',
      })
    })
  })

  it('should handle connection errors', async () => {
    const { result } = renderHook(() =>
      useWebSocket(
        {
          url: 'ws://localhost:8080',
          reconnect: false,
        },
        onMessage
      )
    )

    mockWs?.simulateError()

    await waitFor(() => {
      expect(result.current.state).toBe('error')
      expect(result.current.error).toBeDefined()
    })
  })

  it('should allow manual close', async () => {
    const { result } = renderHook(() =>
      useWebSocket(
        {
          url: 'ws://localhost:8080',
          reconnect: true,
        },
        onMessage
      )
    )

    mockWs?.simulateOpen()

    await waitFor(() => {
      expect(result.current.state).toBe('connected')
    })

    // Close connection
    result.current.close()

    await waitFor(() => {
      expect(result.current.state).toBe('disconnected')
    })

    // Should not attempt reconnection after manual close
    expect(result.current.reconnectAttempts).toBe(0)
  })
})
