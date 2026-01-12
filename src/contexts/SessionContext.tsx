import {
  createContext,
  useContext,
  useState,
  useCallback,
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

  const createSession = useCallback((): Session => {
    const newSession: Session = {
      id: generateSessionId(),
      createdAt: Date.now(),
      expiresAt: createSessionExpiration(1),
      role: "peer", // Modern P2P: all participants are equal peers
    };
    console.log(`[SessionContext] Creating new P2P session: ${newSession.id}`);
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
    console.log(`[SessionContext] Joining P2P session: ${sessionId}`);
    setSession(newSession);
    setError(null);
  }, []);

  const clearSession = useCallback(() => {
    console.log(`[SessionContext] Clearing session`);
    setSession(null);
    setIsConnectedState(false);
    setPeerName(null);
    setError(null);
    setPeers([]);
    setMyPeerId(null);
  }, []);

  const setIsConnected = useCallback((connected: boolean) => {
    console.log(`[SessionContext] Setting isConnected: ${connected}`);
    setIsConnectedState(connected);
  }, []);

  const setPeersWithLogging = useCallback(
    (newPeers: PeerInfo[]) => {
      console.log(`[SessionContext] 📡 Setting peers:`, newPeers);
      console.log(`  - Peer count: ${newPeers.length}`);
      console.log(`  - Peer names: ${newPeers.map((p) => p.name).join(", ")}`);
      console.log(
        `  - Peer IDs (full): ${newPeers.map((p) => p.id).join(", ")}`,
      );
      console.log(
        `  - Peer IDs (short): ${newPeers.map((p) => p.id.slice(0, 8)).join(", ")}`,
      );
      console.log(`  - My peer ID: ${myPeerId}`);
      console.log(`  - My peer ID (short): ${myPeerId?.slice(0, 8)}`);
      console.log(`  - Setting peers at:`, new Date().toLocaleTimeString());

      // Check for timing issues
      if (newPeers.length > 0 && !myPeerId) {
        console.warn(
          `[SessionContext] ⚠️ WARNING: Peers received but myPeerId not set yet!`,
        );
      }

      // Check if any peer matches myPeerId
      const matchesSelf = newPeers.some((p) => p.id === myPeerId);
      if (matchesSelf) {
        console.warn(
          `[SessionContext] ⚠️ WARNING: Peer list includes self! This should be filtered.`,
        );
      }

      setPeers(newPeers);
      console.log(`[SessionContext] ✅ Peers state updated`);
    },
    [myPeerId],
  );

  const setMyPeerIdWithLogging = useCallback((peerId: string) => {
    console.log(
      `[SessionContext] Setting myPeerId: ${peerId} at ${new Date().toLocaleTimeString()}`,
    );
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
