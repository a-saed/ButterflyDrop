export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed"
  | "closed";

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
}

export interface PeerInfo {
  id: string;
  name: string;
  deviceType: string;
  isOnline: boolean;
}

export interface SignalingMessage {
  type:
    | "offer"
    | "answer"
    | "ice-candidate"
    | "session-create"
    | "session-join"
    | "session-leave"
    | "peer-list"
    | "peer-announce"
    | "error"
    | "ping"
    | "pong";
  sessionId?: string;
  networkId?: string;
  peerId?: string;
  peerName?: string;
  deviceType?: string;
  data?: RTCSessionDescriptionInit | RTCIceCandidateInit | string;
  peers?: PeerInfo[];
  error?: string;
}

export interface ConnectionStateChange {
  state: ConnectionState;
  error?: string;
}
