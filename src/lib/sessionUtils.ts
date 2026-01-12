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
  const fullUrl = window.location.href;
  const hash = window.location.hash.slice(1);

  console.log(`[sessionUtils] 🔗 Extracting session ID from URL`);
  console.log(`  - Full URL: ${fullUrl}`);
  console.log(`  - Hash: ${hash}`);

  const params = new URLSearchParams(hash);
  const sessionId = params.get("session");

  console.log(`  - Extracted session ID: ${sessionId || "NOT FOUND"}`);

  if (sessionId) {
    console.log(`  - ✅ Valid session ID found: ${sessionId}`);
  } else {
    console.log(`  - ❌ No session ID in URL`);
  }

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

  // For localhost, use 192.168.0.136 (your LAN IP) for QR codes
  // This allows mobile devices to access the app
  let accessibleHost = hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    // Use environment variable if set, otherwise use detected LAN IP
    const lanIp = import.meta.env.VITE_LAN_IP || "192.168.0.136";
    accessibleHost = lanIp;
    console.log(`[sessionUtils] 📱 Converting localhost to LAN IP: ${lanIp}`);
  }

  const baseUrl = `${protocol}//${accessibleHost}${port ? `:${port}` : ""}${window.location.pathname}`;
  const shareableUrl = `${baseUrl}#session=${sessionId}`;

  console.log(`[sessionUtils] 🔗 Creating shareable URL`);
  console.log(`  - Session ID: ${sessionId}`);
  console.log(`  - Original hostname: ${hostname}`);
  console.log(`  - Accessible host: ${accessibleHost}`);
  console.log(`  - Base URL: ${baseUrl}`);
  console.log(`  - Shareable URL: ${shareableUrl}`);
  console.log(`  - ✅ QR code will contain: ${shareableUrl}`);

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
