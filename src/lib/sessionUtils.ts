import { nanoid } from 'nanoid'

const SESSION_ID_LENGTH = 12

/**
 * Generate a random session ID
 */
export function generateSessionId(): string {
  return nanoid(SESSION_ID_LENGTH)
}

/**
 * Validate session ID format
 */
export function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,16}$/.test(id)
}

/**
 * Get session ID from URL
 */
export function getSessionIdFromUrl(): string | null {
  const hash = window.location.hash.slice(1)
  const params = new URLSearchParams(hash)
  return params.get('session') || null
}

/**
 * Create shareable URL with session ID
 */
export function createShareableUrl(sessionId: string): string {
  const baseUrl = window.location.origin + window.location.pathname
  return `${baseUrl}#session=${sessionId}`
}

/**
 * Check if session has expired
 */
export function isSessionExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt
}

/**
 * Create session expiration time (default: 1 hour)
 */
export function createSessionExpiration(hours: number = 1): number {
  return Date.now() + hours * 60 * 60 * 1000
}

