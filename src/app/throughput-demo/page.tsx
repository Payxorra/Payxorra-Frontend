/**
 * Demo page for ThroughputChart component
 * 
 * Includes:
 * - Mock WebSocket server simulation
 * - High-frequency message generator (200+ msg/s)
 * - Performance monitoring controls
 */

'use client'

import { useState, useEffect, useRef } from 'react'
import { ThroughputChart } from '@/src/components/charts/ThroughputChart'

// Mock WebSocket Server for testing
class MockWebSocketServer {
  private clients: Set<WebSocket> = new Set()
  private intervalId: NodeJS.Timeout | null = null
  private messageRate = 200 // messages per second
  private counter = 0

  start() {
    if (this.intervalId) return

    // Send messages at specified rate
    const intervalMs = 1000 / this.messageRate
    this.intervalId = setInterval(() => {
      this.broadcast({
        timestamp: Date.now(),
        packetsForwarded: Math.floor(Math.random() * 100),
        throughput: Math.random() * 1000 + 500, // 500-1500 packets/s
        nodeId: 'mock-node-1',
      })
      this.counter++
    }, intervalMs)
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  setMessageRate(rate: number) {
    this.messageRate = rate
    if (this.intervalId) {
      this.stop()
      this.start()
    }
  }

  private broadcast(message: unknown) {
    // In a real mock, we'd send to actual WebSocket clients
    // For this demo, we'll emit custom events
    window.dispatchEvent(
      new CustomEvent('mock-ws-message', { detail: message })
    )
  }

  getMessageCount() {
    return this.counter
  }

  reset() {
    this.counter = 0
  }
}

export default function ThroughputDemoPage() {
  const [wsUrl] = useState('ws://localhost:8080/throughput') // Not used in mock
  const [messageRate, setMessageRate] = useState(200)
  const [enablePerformance, setEnablePerformance] = useState(true)
  const [serverRunning, setServerRunning] = useState(false)
  const serverRef = useRef<MockWebSocketServer>(new MockWebSocketServer())

  useEffect(() => {
    // Auto-start server
    serverRef.current.start()
    setServerRunning(true)

    return () => {
      serverRef.current.stop() // eslint-disable-line react-hooks/exhaustive-deps
    }
  }, [])

  const handleRateChange = (rate: number) => {
    setMessageRate(rate)
    serverRef.current.setMessageRate(rate)
  }

  const toggleServer = () => {
    if (serverRunning) {
      serverRef.current.stop()
      setServerRunning(false)
    } else {
      serverRef.current.start()
      setServerRunning(true)
    }
  }

  const resetStats = () => {
    serverRef.current.reset()
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            ThroughputChart Performance Demo
          </h1>
          <p className="mt-2 text-muted">
            Testing high-frequency data streaming with throttling and batching
          </p>
        </div>

        {/* Controls */}
        <div className="mb-8 rounded-lg border border-border bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Mock WebSocket Controls
          </h2>

          <div className="grid gap-4 md:grid-cols-3">
            {/* Server Control */}
            <div>
              <label className="mb-2 block text-sm font-medium text-muted">
                Server Status
              </label>
              <button
                onClick={toggleServer}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
                  serverRunning
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {serverRunning ? 'Stop Server' : 'Start Server'}
              </button>
            </div>

            {/* Message Rate */}
            <div>
              <label className="mb-2 block text-sm font-medium text-muted">
                Message Rate: {messageRate} msg/s
              </label>
              <input
                type="range"
                min="10"
                max="500"
                step="10"
                value={messageRate}
                onChange={(e) => handleRateChange(Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-1 flex justify-between text-xs text-muted">
                <span>10</span>
                <span>500</span>
              </div>
            </div>

            {/* Performance Tracking */}
            <div>
              <label className="mb-2 block text-sm font-medium text-muted">
                Performance Tracking
              </label>
              <button
                onClick={() => setEnablePerformance(!enablePerformance)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  enablePerformance
                    ? 'bg-primary text-primary-text'
                    : 'bg-surface-alt text-muted-text'
                }`}
              >
                {enablePerformance ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={resetStats}
              className="rounded-lg bg-muted px-4 py-2 text-sm font-medium text-surface transition-colors hover:bg-muted-text"
            >
              Reset Statistics
            </button>
          </div>
        </div>

        {/* Technical Bounds Display */}
        <div className="mb-8 rounded-lg border border-border bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Technical Bounds & Invariants
          </h2>
          <div className="space-y-2 text-sm text-muted">
            <p>✓ Chart updates limited to 1 render per 500ms</p>
            <p>✓ Maximum 200 data points in sliding window buffer</p>
            <p>✓ FIFO eviction for oldest data points</p>
            <p>✓ Zero message loss - all messages captured</p>
            <p>✓ First message triggers immediate render (no latency)</p>
            <p>✓ Performance monitoring with 16ms render threshold</p>
          </div>
        </div>

        {/* Chart */}
        <div className="mb-8">
          <ThroughputChart
            wsUrl={wsUrl}
            title="Real-time Network Throughput"
            height={500}
            enablePerformanceTracking={enablePerformance}
            lineColor="#0f766e"
            gridColor="#e5e7eb"
          />
        </div>

        {/* Implementation Notes */}
        <div className="rounded-lg border border-border bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Implementation Details
          </h2>
          <div className="space-y-4 text-sm text-muted">
            <div>
              <h3 className="font-semibold text-foreground">SlidingWindow</h3>
              <p>
                Ring buffer with fixed capacity (200). O(1) insertion and
                retrieval. Automatic FIFO eviction.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">useDataThrottle</h3>
              <p>
                Accumulates messages between render intervals (500ms). First
                message triggers immediate render. Uses requestAnimationFrame
                for optimal timing.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">useWebSocket</h3>
              <p>
                Generic WebSocket hook with automatic reconnection, exponential
                backoff, and message queuing.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">
                Performance Monitoring
              </h3>
              <p>
                Tracks render duration using performance.now(). Logs warnings
                when renders exceed 16ms (frame budget).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
