export type ConnectionState = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed'

export interface WebRTCConfig {
  iceServers: RTCIceServer[]
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'session-join' | 'session-ready' | 'error'
  sessionId: string
  data?: RTCSessionDescriptionInit | RTCIceCandidateInit | string
}

export interface ConnectionStateChange {
  state: ConnectionState
  error?: string
}

