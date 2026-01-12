export interface Session {
  id: string;
  createdAt: number;
  expiresAt: number;
  role: "peer"; // Modern P2P: all participants are equal peers
}

export interface SessionState {
  session: Session | null;
  isConnected: boolean;
  peerName: string | null;
  error: string | null;
}
