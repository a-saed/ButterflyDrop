/**
 * Shared signaling server URL configuration.
 * Single source of truth — imported by useWebRTC_v2, useServerWarmup, etc.
 */

/**
 * Converts a WebSocket URL to its HTTP equivalent.
 * ws://host  → http://host
 * wss://host → https://host
 */
export function signalingToHttpUrl(signalingUrl: string): string {
  return signalingUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
}

/**
 * Derives the correct signaling server WebSocket URL based on the environment.
 * Priority:
 *  1. VITE_SIGNALING_URL env var (explicit override)
 *  2. Local dev / LAN IP → ws://hostname:8080
 *  3. Production         → wss://hostname  (same host, no port)
 */
export function getSignalingUrl(): string {
  // 1. Explicit env override (set in .env or Render/Vercel dashboard)
  if (import.meta.env.VITE_SIGNALING_URL) {
    console.log(
      `🔧 Signaling URL from env: ${import.meta.env.VITE_SIGNALING_URL}`,
    )
    return import.meta.env.VITE_SIGNALING_URL
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const hostname = window.location.hostname

  // 2. Local IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  const isLocalIP =
    /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(hostname)

  if (hostname === 'localhost' || hostname === '127.0.0.1' || isLocalIP) {
    const url = `${protocol}//${hostname}:8080`
    console.log(`💻 Local dev — signaling: ${url}`)
    return url
  }

  // 3. Production — same hostname, no explicit port (reverse-proxied)
  const url = `${protocol}//${hostname}`
  console.log(`🌐 Production — signaling: ${url}`)
  return url
}

/** WebSocket URL for the signaling server. */
export const SIGNALING_URL: string = getSignalingUrl()

/** HTTP(S) URL for the signaling server — used for health-check pinging. */
export const SIGNALING_HTTP_URL: string = signalingToHttpUrl(SIGNALING_URL)
