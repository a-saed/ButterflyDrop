import type { SignalingMessage } from "@/types/webrtc";

type SignalingEventType = "message" | "open" | "close" | "error";
type SignalingEventHandler = (data?: unknown) => void;

/**
 * WebSocket signaling client for WebRTC connection setup
 */
export class SignalingClient {
  private ws: WebSocket | null = null;
  private eventHandlers: Map<SignalingEventType, Set<SignalingEventHandler>> =
    new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private url: string;
  private messageQueue: SignalingMessage[] = [];
  private isProcessingQueue = false;

  constructor(url: string = "ws://localhost:8080") {
    this.url = url;
  }

  /**
   * Connect to signaling server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`🔌 Attempting WebSocket connection to: ${this.url}`);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log(`✅ WebSocket connected to: ${this.url}`);
          this.reconnectAttempts = 0;
          this.emit("open");
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: SignalingMessage = JSON.parse(event.data);
            // Add message to queue for sequential processing
            this.messageQueue.push(message);
            this.processMessageQueue();
          } catch (error) {
            console.error("Failed to parse signaling message:", error);
          }
        };

        this.ws.onclose = (event) => {
          console.log(`⚠️ WebSocket closed: code=${event.code}, reason=${event.reason || "none"}`);
          this.emit("close");
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error(`❌ WebSocket error connecting to ${this.url}:`, error);
          console.error(`   Check if the signaling server is running and accessible`);
          this.emit("error", error);
          reject(error);
        };
      } catch (error) {
        console.error(`❌ Failed to create WebSocket to ${this.url}:`, error);
        reject(error);
      }
    });
  }

  /**
   * Process message queue sequentially to avoid race conditions
   */
  private async processMessageQueue(): Promise<void> {
    // If already processing, skip (will be processed by current iteration)
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        // Emit message to handlers and wait for them to complete
        await this.emitAsync("message", message);
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Emit event to all handlers asynchronously (wait for completion)
   */
  private async emitAsync(
    event: SignalingEventType,
    data?: unknown,
  ): Promise<void> {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      // Execute all handlers sequentially to maintain order
      for (const handler of handlers) {
        try {
          const result = handler(data);
          // If handler returns a promise, wait for it
          if (result !== undefined && result !== null && typeof result === "object" && "then" in result) {
            await result;
          }
        } catch (error) {
          console.error("Error in signaling event handler:", error);
        }
      }
    }
  }

  /**
   * Attempt to reconnect to signaling server
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connect().catch(() => {
          // Reconnection failed, will retry
        });
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  /**
   * Send signaling message
   */
  send(message: SignalingMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error("WebSocket is not connected");
    }
  }

  /**
   * Subscribe to signaling events
   */
  on(event: SignalingEventType, handler: SignalingEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  /**
   * Emit event to all handlers
   */
  private emit(event: SignalingEventType, data?: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  /**
   * Disconnect from signaling server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.eventHandlers.clear();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
