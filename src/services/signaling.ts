import type { SignalingMessage } from '@/types/webrtc'

type SignalingEventType = 'message' | 'open' | 'close' | 'error'
type SignalingEventHandler = (data?: unknown) => void

/**
 * WebSocket signaling client for WebRTC connection setup
 */
export class SignalingClient {
  private ws: WebSocket | null = null
  private eventHandlers: Map<SignalingEventType, Set<SignalingEventHandler>> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private url: string

  constructor(url: string = 'ws://localhost:8080') {
    this.url = url
  }

  /**
   * Connect to signaling server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url)

        this.ws.onopen = () => {
          this.reconnectAttempts = 0
          this.emit('open')
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const message: SignalingMessage = JSON.parse(event.data)
            this.emit('message', message)
          } catch (error) {
            console.error('Failed to parse signaling message:', error)
          }
        }

        this.ws.onclose = () => {
          this.emit('close')
          this.attemptReconnect()
        }

        this.ws.onerror = (error) => {
          this.emit('error', error)
          reject(error)
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Attempt to reconnect to signaling server
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      setTimeout(() => {
        this.connect().catch(() => {
          // Reconnection failed, will retry
        })
      }, this.reconnectDelay * this.reconnectAttempts)
    }
  }

  /**
   * Send signaling message
   */
  send(message: SignalingMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      console.error('WebSocket is not connected')
    }
  }

  /**
   * Subscribe to signaling events
   */
  on(event: SignalingEventType, handler: SignalingEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(event)?.delete(handler)
    }
  }

  /**
   * Emit event to all handlers
   */
  private emit(event: SignalingEventType, data?: unknown): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.forEach((handler) => handler(data))
    }
  }

  /**
   * Disconnect from signaling server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.eventHandlers.clear()
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

