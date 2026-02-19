import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { Session, SessionState } from "@/types/session";
import type { PeerInfo } from "@/types/webrtc";
import { generateSessionId, createSessionExpiration } from "@/lib/sessionUtils";

interface SessionContextValue extends SessionState {
  createSession: () => Session;
  joinSession: (sessionId: string) => void;
  clearSession: () => void;
  setPeerName: (name: string | null) => void;
  setError: (error: string | null) => void;
  setIsConnected: (connected: boolean) => void;
  peers: PeerInfo[];
  setPeers: (peers: PeerInfo[]) => void;
  myPeerId: string | null;
  setMyPeerId: (peerId: string) => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(
  undefined,
);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isConnected, setIsConnectedState] = useState(false);
  const [peerName, setPeerName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  // Ref mirror of myPeerId so setPeersWithLogging doesn't need myPeerId in its
  // dependency array (which would cause handlePeerListUpdate → initialize to
  // recreate on every setMyPeerId call, triggering an effect cleanup that tears
  // down the WebRTC connection while the session is still live).
  const myPeerIdRef = useRef<string | null>(null);

  const createSession = useCallback((): Session => {
    const newSession: Session = {
      id: generateSessionId(),
      createdAt: Date.now(),
      expiresAt: createSessionExpiration(1),
      role: "peer", // Modern P2P: all participants are equal peers
    };
    setSession(newSession);
    setError(null);
    return newSession;
  }, []);

  const joinSession = useCallback((sessionId: string) => {
    const newSession: Session = {
      id: sessionId,
      createdAt: Date.now(),
      expiresAt: createSessionExpiration(1),
      role: "peer", // Modern P2P: all participants are equal peers
    };
    setSession(newSession);
    setError(null);
  }, []);

  const clearSession = useCallback(() => {
    setSession(null);
    setIsConnectedState(false);
    setPeerName(null);
    setError(null);
    setPeers([]);
    setMyPeerId(null);
  }, []);

  const setIsConnected = useCallback((connected: boolean) => {
    setIsConnectedState(connected);
  }, []);

  // IMPORTANT: keep dep array empty so this function reference is stable for
  // the lifetime of the provider. myPeerIdRef.current is used for any checks
  // that need the current peer ID at call-time without recreating the callback.
  const setPeersWithLogging = useCallback((newPeers: PeerInfo[]) => {
    if (import.meta.env.DEV) {
      // Check for timing issues
      if (newPeers.length > 0 && !myPeerIdRef.current) {
        console.warn(
          `[SessionContext] ⚠️ WARNING: Peers received but myPeerId not set yet!`,
        );
      }
      // Check if any peer matches myPeerId
      const matchesSelf = newPeers.some((p) => p.id === myPeerIdRef.current);
      if (matchesSelf) {
        console.warn(
          `[SessionContext] ⚠️ WARNING: Peer list includes self! This should be filtered.`,
        );
      }
    }
    setPeers(newPeers);
  }, []); // ← stable: no deps, uses ref for runtime checks

  const setMyPeerIdWithLogging = useCallback((peerId: string) => {
    myPeerIdRef.current = peerId;
    setMyPeerId(peerId);
  }, []);

  const value: SessionContextValue = {
    session,
    isConnected,
    peerName,
    error,
    peers,
    myPeerId,
    createSession,
    joinSession,
    clearSession,
    setPeerName,
    setError: setError,
    setIsConnected,
    setPeers: setPeersWithLogging,
    setMyPeerId: setMyPeerIdWithLogging,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
