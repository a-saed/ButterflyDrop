import type { SignalingMessage } from "@/types/webrtc";

type SignalingEventType = "message" | "open" | "close" | "error";
type SignalingEventHandler = (data?: unknown) => void;

/**
 * WebSocket signaling client for WebRTC connection setup.
 *
 * Key improvements over the previous version:
 * - Intentional-close guard: disconnect() no longer triggers reconnect loop
 * - Application-level heartbeat (ping every 25 s) to keep WS alive through
 *   proxies that close idle connections (Nginx, Render, etc.)
 * - Exponential back-off with jitter so multiple tabs/devices don't hammer
 *   the server simultaneously after a restart
 * - Single reconnect timer slot — no duplicate reconnect races
 * - Clean separation between initial connect() and background reconnects
 */
export class SignalingClient {
  // ─── WebSocket ────────────────────────────────────────────────────────────
  private ws: WebSocket | null = null;
  private readonly url: string;

  // ─── Reconnection ─────────────────────────────────────────────────────────
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 20;
  private readonly baseReconnectDelayMs = 1_000;
  private readonly maxReconnectDelayMs = 15_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Set to true only by disconnect(). Prevents the onclose handler from
   * scheduling a reconnect after we intentionally closed the socket.
   */
  private isIntentionallyClosed = false;

  // ─── Connection timeout ───────────────────────────────────────────────────
  /**
   * How long connect() will wait for the WebSocket handshake before giving up.
   * 60 s is generous enough for Render.com cold-starts.
   */
  private readonly connectTimeoutMs = 60_000;

  // ─── Heartbeat ────────────────────────────────────────────────────────────
  /**
   * Interval between application-level pings.
   * 25 s keeps us inside the typical 30–60 s idle-close window of most proxies.
   */
  private readonly heartbeatIntervalMs = 25_000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ─── Message queue ────────────────────────────────────────────────────────
  /**
   * Sequential queue so that async message handlers (offer/answer/ICE) never
   * interleave with each other.
   */
  private messageQueue: SignalingMessage[] = [];
  private isProcessingQueue = false;

  // ─── Event handlers ───────────────────────────────────────────────────────
  private eventHandlers: Map<SignalingEventType, Set<SignalingEventHandler>> =
    new Map();

  // ─────────────────────────────────────────────────────────────────────────

  constructor(url: string = "ws://localhost:8080") {
    this.url = url;
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Open the WebSocket connection.
   * Resolves when the socket is OPEN; rejects on error or timeout.
   * Safe to call again after the socket closes — creates a fresh socket.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Guard: don't open a new socket if we're intentionally closed
      if (this.isIntentionallyClosed) {
        reject(new Error("SignalingClient has been disconnected"));
        return;
      }

      try {
        this.ws = new WebSocket(this.url);
      } catch (error) {
        console.error(`Failed to create WebSocket to ${this.url}:`, error);
        reject(error);
        return;
      }

      // Reject if the server doesn't respond within connectTimeoutMs.
      const connectionTimeout = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          console.warn(
            `WebSocket connection timed out after ${this.connectTimeoutMs / 1_000}s`,
          );
          this.ws.close();
          reject(new Error("WebSocket connection timed out"));
        }
      }, this.connectTimeoutMs);

      // ── onopen ─────────────────────────────────────────────────────────
      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit("open");
        resolve();
      };

      // ── onmessage ──────────────────────────────────────────────────────
      this.ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data) as { type?: string };

          // Silently swallow server-side pong/ping — they're only for keepalive
          if (raw.type === "pong" || raw.type === "ping") return;

          this.messageQueue.push(raw as SignalingMessage);
          this.processMessageQueue();
        } catch (error) {
          console.error("Failed to parse signaling message:", error);
        }
      };

      // ── onclose ────────────────────────────────────────────────────────
      this.ws.onclose = () => {
        clearTimeout(connectionTimeout);
        this.stopHeartbeat();
        this.emit("close");

        if (!this.isIntentionallyClosed) {
          // Unintentional close — schedule a reconnect attempt
          this.scheduleReconnect();
        }
        // If intentionally closed we do nothing; the caller owns lifecycle.
      };

      // ── onerror ────────────────────────────────────────────────────────
      this.ws.onerror = (error) => {
        // onerror is always followed by onclose, which drives reconnect.
        // We only need to reject the initial connect() promise here.
        clearTimeout(connectionTimeout);
        this.emit("error", error);
        reject(error);
      };
    });
  }

  /**
   * Send a signaling message.
   * Silently drops messages when the socket is not OPEN so callers don't need
   * to guard every send site.
   */
  send(message: SignalingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error("Failed to send signaling message:", error);
      }
    }
    // If not connected, messages are dropped. The session-join will be
    // re-sent in the "open" handler after the next reconnect.
  }

  /**
   * Subscribe to a signaling lifecycle or message event.
   * Returns an unsubscribe function.
   */
  on(event: SignalingEventType, handler: SignalingEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  /**
   * Permanently close the connection and stop all reconnect attempts.
   * After this call, the instance is unusable — create a new one to reconnect.
   */
  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();
    this.cancelReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageQueue = [];
    this.eventHandlers.clear();
  }

  /** True only when the underlying WebSocket is in the OPEN state. */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // =========================================================================
  // Heartbeat
  // =========================================================================

  /**
   * Start sending periodic application-level pings.
   * Keeps the WebSocket alive through proxies that close idle connections
   * (many close after 30–60 s with no traffic).
   */
  private startHeartbeat(): void {
    this.stopHeartbeat(); // defensive — avoid duplicate intervals
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          // Socket might already be dead. onclose will handle cleanup.
        }
      } else {
        // Socket is gone but heartbeat wasn't stopped — clean up defensively
        this.stopHeartbeat();
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // =========================================================================
  // Reconnect logic
  // =========================================================================

  /**
   * Schedule a single reconnect attempt with exponential back-off + jitter.
   *
   * Jitter (±20 % of the computed delay) prevents a thundering-herd where
   * many clients reconnect simultaneously after a server restart.
   */
  private scheduleReconnect(): void {
    // Only one scheduled reconnect at a time
    if (this.reconnectTimer !== null) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(
        `[SignalingClient] Gave up reconnecting after ${this.maxReconnectAttempts} attempts`,
      );
      return;
    }

    this.reconnectAttempts++;

    // Exponential back-off: 1 s, 1.5 s, 2.25 s … capped at maxReconnectDelayMs
    const exponential = Math.min(
      this.baseReconnectDelayMs * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelayMs,
    );
    // Add ±20 % jitter
    const jitter = exponential * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.round(exponential + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isIntentionallyClosed) {
        // connect() failure is handled by the new onclose which will call
        // scheduleReconnect() again automatically.
        this.connect().catch(() => {});
      }
    }, delay);
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // =========================================================================
  // Message queue
  // =========================================================================

  /**
   * Process queued signaling messages sequentially.
   * Ensures that async offer/answer/ICE handlers never interleave and produce
   * a race condition in the WebRTC state machine.
   */
  private async processMessageQueue(): Promise<void> {
    if (this.isProcessingQueue) return;

    this.isProcessingQueue = true;
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        await this.emitAsync("message", message);
      }
    }
    this.isProcessingQueue = false;
  }

  // =========================================================================
  // Internal event emission
  // =========================================================================

  /** Synchronous emit — used for lifecycle events (open/close/error). */
  private emit(event: SignalingEventType, data?: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in signaling "${event}" handler:`, err);
        }
      });
    }
  }

  /**
   * Async emit — waits for each handler to settle before advancing to the
   * next message. This prevents out-of-order processing when offer/answer
   * handlers do `await pc.setRemoteDescription(...)`.
   */
  private async emitAsync(
    event: SignalingEventType,
    data?: unknown,
  ): Promise<void> {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        const result = handler(data);
        if (
          result !== null &&
          result !== undefined &&
          typeof (result as Promise<unknown>).then === "function"
        ) {
          await result;
        }
      } catch (error) {
        console.error(`Error in signaling "${event}" async handler:`, error);
      }
    }
  }
}
