import { useState, useEffect, useRef, useCallback } from "react";
import {
  pingServer,
  isLocalServer,
  type WarmupStatus,
  POLL_INTERVAL_MS,
  WARM_THRESHOLD_MS,
  MAX_WARMUP_MS,
} from "@/lib/serverWarmup";
import { SIGNALING_HTTP_URL } from "@/lib/signalingConfig";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseServerWarmupResult {
  /** Current warm-up lifecycle status */
  status: WarmupStatus;
  /** Seconds elapsed since warm-up started */
  elapsed: number;
  /**
   * True only after WARM_THRESHOLD_MS have passed without a server response.
   * Stays false if the server was already warm (fast response) — overlay never
   * flashes for users who don't need it.
   */
  showOverlay: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the server warm-up lifecycle:
 *
 * 1. On mount, immediately fires an HTTP GET /health ping.
 * 2. If the server replies within WARM_THRESHOLD_MS → status jumps to 'ready',
 *    showOverlay stays false (no overlay ever shown).
 * 3. If it takes longer → showOverlay becomes true, status = 'warming', and
 *    we keep polling every POLL_INTERVAL_MS until the server responds.
 * 4. After MAX_WARMUP_MS with no response → status = 'timeout'.
 * 5. Local dev servers skip the whole flow and immediately resolve as 'ready'.
 */
export function useServerWarmup(): UseServerWarmupResult {
  const [status, setStatus] = useState<WarmupStatus>("checking");
  const [elapsed, setElapsed] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);

  // Internal refs — avoid stale-closure issues and allow cleanup
  const startTimeRef = useRef<number>(0);
  const isMountedRef = useRef(true);
  const isDoneRef = useRef(false);

  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  const clearAllTimers = useCallback(() => {
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
  }, []);

  /**
   * Called as soon as we get a successful /health response.
   * Clears all timers, sets status to 'ready'.
   * The overlay (if visible) will detect this and begin its fade-out.
   */
  const markReady = useCallback(() => {
    if (!isMountedRef.current || isDoneRef.current) return;
    isDoneRef.current = true;
    clearAllTimers();
    setStatus("ready");
  }, [clearAllTimers]);

  /**
   * Starts polling /health every POLL_INTERVAL_MS.
   * Only called after the initial ping already failed.
   */
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return; // already polling

    pollIntervalRef.current = setInterval(async () => {
      if (!isMountedRef.current || isDoneRef.current) return;
      const ok = await pingServer(SIGNALING_HTTP_URL);
      if (ok) markReady();
    }, POLL_INTERVAL_MS);
  }, [markReady]);

  // ------------------------------------------------------------------
  // Main effect
  // ------------------------------------------------------------------

  useEffect(() => {
    isMountedRef.current = true;
    isDoneRef.current = false;
    startTimeRef.current = Date.now(); // safe here — inside effect, not render

    // Local dev servers (localhost, LAN IPs) never go cold — skip entirely
    if (isLocalServer(SIGNALING_HTTP_URL)) {
      // Defer out of the synchronous effect body to satisfy React's rules
      const t = setTimeout(() => {
        if (isMountedRef.current) setStatus("ready");
      }, 0);
      return () => clearTimeout(t);
    }

    // status is already 'checking' from useState initial value

    // --- Elapsed counter (updates every second) -------------------------
    elapsedIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1_000);

    // --- Show overlay after threshold ----------------------------------
    // Only reveal the overlay if the server hasn't responded quickly.
    overlayTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current || isDoneRef.current) return;
      setShowOverlay(true);
      setStatus("warming");
    }, WARM_THRESHOLD_MS);

    // --- Absolute timeout -------------------------------------------
    maxWaitTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current || isDoneRef.current) return;
      isDoneRef.current = true;
      clearAllTimers();
      setStatus("timeout");
      // Keep showOverlay true so the timeout state is visible
    }, MAX_WARMUP_MS);

    // --- Initial immediate ping -------------------------------------
    pingServer(SIGNALING_HTTP_URL).then((ok) => {
      if (!isMountedRef.current || isDoneRef.current) return;

      if (ok) {
        // Server was already warm — resolve before the overlay threshold fires
        markReady();
      } else {
        // Cold server — start polling and wait for overlay timer
        startPolling();
      }
    });

    return () => {
      isMountedRef.current = false;
      clearAllTimers();
    };
  }, [markReady, startPolling, clearAllTimers]);

  // ------------------------------------------------------------------
  // Auto-hide overlay after 'ready' (gives animation time to play)
  // ------------------------------------------------------------------

  useEffect(() => {
    if (status !== "ready" || !showOverlay) return;

    // Keep overlay visible briefly so the success state is seen, then hide
    const hideTimer = setTimeout(() => {
      if (isMountedRef.current) setShowOverlay(false);
    }, 1_600);

    return () => clearTimeout(hideTimer);
  }, [status, showOverlay]);

  return { status, elapsed, showOverlay };
}
