import { useEffect } from 'react'
import { useSession as useSessionContext } from '@/contexts/SessionContext'
import { getSessionIdFromUrl, createShareableUrl } from '@/lib/sessionUtils'

/**
 * Hook to manage session lifecycle and URL synchronization
 */
export function useSession() {
  const sessionContext = useSessionContext()

  // Check for session ID in URL on mount
  useEffect(() => {
    const sessionId = getSessionIdFromUrl()
    if (sessionId && !sessionContext.session) {
      sessionContext.joinSession(sessionId)
    } else if (!sessionId && !sessionContext.session) {
      // Create new session if none exists
      const newSession = sessionContext.createSession()
      // Update URL with session ID
      const shareableUrl = createShareableUrl(newSession.id)
      window.history.replaceState(null, '', shareableUrl)
    }
  }, [sessionContext])

  // Update URL when session changes
  useEffect(() => {
    if (sessionContext.session) {
      const shareableUrl = createShareableUrl(sessionContext.session.id)
      const currentHash = window.location.hash
      const expectedHash = `#session=${sessionContext.session.id}`
      
      // Only update if hash doesn't match
      if (currentHash !== expectedHash) {
        window.history.replaceState(null, '', shareableUrl)
      }
    }
  }, [sessionContext.session])

  return sessionContext
}

