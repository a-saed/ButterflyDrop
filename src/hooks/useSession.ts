import { useEffect, useRef } from "react";
import { useSession as useSessionContext } from "@/contexts/SessionContext";
import { getSessionIdFromUrl, createShareableUrl } from "@/lib/sessionUtils";

console.log("🔄 [useSession] Hook initialized");

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

    console.log("🔄 [useSession] Effect triggered - checking URL for session");
    console.log(`  - Current URL: ${window.location.href}`);
    console.log(`  - Current hash: ${window.location.hash}`);

    const sessionId = getSessionIdFromUrl();
    console.log(`  - Extracted session ID: ${sessionId || "NONE"}`);
    console.log(
      `  - Existing session: ${sessionContext.session?.id || "NONE"}`,
    );

    if (sessionId && !sessionContext.session) {
      console.log(
        `✅ [useSession] Joining existing session from URL: ${sessionId}`,
      );
      hasProcessedInitialUrlRef.current = true;
      sessionContext.joinSession(sessionId);
    } else if (!sessionId && !sessionContext.session) {
      // Create new session if none exists
      console.log("🆕 [useSession] No session in URL, creating new session");
      hasProcessedInitialUrlRef.current = true;
      const newSession = sessionContext.createSession();
      // Update URL with session ID (only update hash, not full URL)
      const newHash = `#session=${newSession.id}`;
      console.log(`🔗 [useSession] Updating URL hash to: ${newHash}`);
      window.history.replaceState(null, "", newHash);
      console.log(
        `✅ [useSession] URL updated with session ID: ${newSession.id}`,
      );
    } else if (sessionId && sessionContext.session) {
      console.log(`ℹ️ [useSession] Session already exists, skipping join`);
      hasProcessedInitialUrlRef.current = true;
    } else {
      console.log(
        `ℹ️ [useSession] No session ID and session exists, nothing to do`,
      );
      hasProcessedInitialUrlRef.current = true;
    }
  }, [sessionContext]);

  // Update URL when session changes
  useEffect(() => {
    if (sessionContext.session) {
      const shareableUrl = createShareableUrl(sessionContext.session.id);
      const currentHash = window.location.hash;
      const expectedHash = `#session=${sessionContext.session.id}`;

      console.log(`🔄 [useSession] Session changed, checking URL sync`);
      console.log(`  - Current hash: ${currentHash}`);
      console.log(`  - Expected hash: ${expectedHash}`);

      // Only update if hash doesn't match
      if (currentHash !== expectedHash) {
        console.log(`🔗 [useSession] Syncing URL with session ID`);
        window.history.replaceState(null, "", shareableUrl);
        console.log(`✅ [useSession] URL synced to: ${shareableUrl}`);
      } else {
        console.log(`✅ [useSession] URL already synced`);
      }
    }
  }, [sessionContext.session]);

  return sessionContext;
}
