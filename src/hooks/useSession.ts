import { useEffect, useRef } from "react";
import { useSession as useSessionContext } from "@/contexts/SessionContext";
import {
  getSessionIdFromUrl,
  getSessionIdFromBdpParam,
  createShareableUrl,
} from "@/lib/sessionUtils";

/**
 * Hook to manage session lifecycle and URL synchronization
 */
export function useSession() {
  const sessionContext = useSessionContext();

  // Track if we've already processed the initial URL check
  const hasProcessedInitialUrlRef = useRef(false);

  // Check for session ID in URL on mount
  useEffect(() => {
    // Only process once on mount
    if (hasProcessedInitialUrlRef.current) {
      return;
    }

    // Prefer hash (#session=...), then ?bdp= (BDP join link) so joiner lands in correct room
    let sessionId = getSessionIdFromUrl();
    if (!sessionId) {
      sessionId = getSessionIdFromBdpParam();
    }

    if (sessionId && !sessionContext.session) {
      hasProcessedInitialUrlRef.current = true;
      sessionContext.joinSession(sessionId);
    } else if (!sessionId && !sessionContext.session) {
      // Create new session if none exists
      hasProcessedInitialUrlRef.current = true;
      const newSession = sessionContext.createSession();
      // Update URL with session ID (only update hash, not full URL)
      window.history.replaceState(null, "", `#session=${newSession.id}`);
    } else {
      hasProcessedInitialUrlRef.current = true;
    }
  }, [sessionContext]);

  // Update URL when session changes
  useEffect(() => {
    if (sessionContext.session) {
      const expectedHash = `#session=${sessionContext.session.id}`;
      // Only update if hash doesn't match
      if (window.location.hash !== expectedHash) {
        const shareableUrl = createShareableUrl(sessionContext.session.id);
        window.history.replaceState(null, "", shareableUrl);
      }
    }
  }, [sessionContext.session]);

  return sessionContext;
}
