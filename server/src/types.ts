/**
 * Signaling message types for WebRTC handshaking
 */

import type { WebSocket } from "ws";

export interface SignalingMessage {
  type:
    | "offer"
    | "answer"
    | "ice-candidate"
    | "session-create"
    | "session-join"
    | "session-leave"
    | "peer-announce"
    | "peer-list"
    | "network-list"
    | "error"
    | "ping"
    | "pong";
  sessionId?: string;
  networkId?: string;
  peerId?: string;
  peerName?: string;
  deviceType?: string;
  data?: unknown;
  error?: string;
  peers?: PeerInfo[];
  networks?: NetworkInfo[];
  success?: boolean;
}

export interface PeerInfo {
  id: string;
  name: string;
  deviceType: string;
  isOnline: boolean;
}

export interface NetworkInfo {
  id: string;
  name: string;
  peerCount: number;
  createdAt: number;
}

export interface Session {
  id: string;
  createdAt: number;
  sender?: WebSocket;
  receiver?: WebSocket;
  peers?: Map<string, PeerConnection>; // For multi-peer support
  lastActivity: number;
}

export interface PeerConnection {
  ws: WebSocket;
  peerId: string;
  peerName: string;
  deviceType: string;
  joinedAt: number;
}
