/**
 * Server warm-up utilities.
 *
 * Render's free tier spins down after ~15 min of inactivity.
 * These helpers let us detect a cold server and poll until it's ready,
 * so the WebSocket connection isn't attempted until HTTP responds.
 */

import { SIGNALING_HTTP_URL } from '@/lib/signalingConfig'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long (ms) to wait for a single /health ping before giving up on it. */
export const PING_TIMEOUT_MS = 5_000

/** How often (ms) to re-ping while the server is still cold. */
export const POLL_INTERVAL_MS = 3_000

/** If the server replies within this window, we consider it already warm (no overlay). */
export const WARM_THRESHOLD_MS = 2_000

/** Total time (ms) we're willing to wait before declaring a timeout. */
export const MAX_WARMUP_MS = 90_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WarmupStatus = 'idle' | 'checking' | 'warming' | 'ready' | 'timeout'

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Fires a single HEAD/GET request at /health and returns true if the server
 * responded with a 2xx status.  Never throws — returns false on any error.
 */
export async function pingServer(
  httpUrl: string = SIGNALING_HTTP_URL,
): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)

    const res = await fetch(`${httpUrl}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })

    clearTimeout(timer)
    return res.ok
  } catch {
    // AbortError, NetworkError, etc. — server not ready yet
    return false
  }
}

/**
 * Returns true if the signaling server appears to be a local dev server
 * (localhost or LAN IP).  Local servers don't have cold-start problems,
 * so we can skip the warm-up flow entirely.
 */
export function isLocalServer(httpUrl: string = SIGNALING_HTTP_URL): boolean {
  try {
    const { hostname } = new URL(httpUrl)
    const localPattern =
      /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/
    return localPattern.test(hostname)
  } catch {
    return false
  }
}
