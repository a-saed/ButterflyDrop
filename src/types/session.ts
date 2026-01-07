export interface Session {
  id: string
  createdAt: number
  expiresAt: number
  role: 'sender' | 'receiver'
}

export interface SessionState {
  session: Session | null
  isConnected: boolean
  peerName: string | null
  error: string | null
}

