import { nanoid } from "nanoid";

const SESSION_ID_LENGTH = 12;

/**
 * Generate a random session ID
 */
export function generateSessionId(): string {
  return nanoid(SESSION_ID_LENGTH);
}

/**
 * Validate session ID format
 */
export function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,16}$/.test(id);
}

/**
 * Get session ID from URL
 */
export function getSessionIdFromUrl(): string | null {
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const sessionId = params.get("session");
  return sessionId || null;
}

/**
 * Create shareable URL with session ID
 * Uses LAN IP for mobile access instead of localhost
 */
export function createShareableUrl(sessionId: string): string {
  const hostname = window.location.hostname;
  const port = window.location.port;
  const protocol = window.location.protocol;

  // For localhost, use environment variable for LAN IP if set
  // This allows mobile devices to access the app when testing locally
  let accessibleHost = hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    // Use environment variable if set, otherwise keep localhost
    // Users should set VITE_LAN_IP in .env.local for local testing
    const lanIp = import.meta.env.VITE_LAN_IP;
    if (lanIp) {
      accessibleHost = lanIp;
      console.log(`[sessionUtils] 📱 Converting localhost to LAN IP: ${lanIp}`);
    }
  }

  const baseUrl = `${protocol}//${accessibleHost}${port ? `:${port}` : ""}${window.location.pathname}`;
  const shareableUrl = `${baseUrl}#session=${sessionId}`;
  return shareableUrl;
}

/**
 * Check if session has expired
 */
export function isSessionExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}

/**
 * Create session expiration time (default: 1 hour)
 */
export function createSessionExpiration(hours: number = 1): number {
  return Date.now() + hours * 60 * 60 * 1000;
}
