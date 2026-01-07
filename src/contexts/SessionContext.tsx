import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import type { Session, SessionState } from '@/types/session'
import { generateSessionId, createSessionExpiration } from '@/lib/sessionUtils'

interface SessionContextValue extends SessionState {
  createSession: () => Session
  joinSession: (sessionId: string) => void
  clearSession: () => void
  setPeerName: (name: string | null) => void
  setError: (error: string | null) => void
  setIsConnected: (connected: boolean) => void
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isConnected, setIsConnectedState] = useState(false)
  const [peerName, setPeerName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const createSession = useCallback((): Session => {
    const newSession: Session = {
      id: generateSessionId(),
      createdAt: Date.now(),
      expiresAt: createSessionExpiration(1),
      role: 'sender',
    }
    setSession(newSession)
    setError(null)
    return newSession
  }, [])

  const joinSession = useCallback((sessionId: string) => {
    const newSession: Session = {
      id: sessionId,
      createdAt: Date.now(),
      expiresAt: createSessionExpiration(1),
      role: 'receiver',
    }
    setSession(newSession)
    setError(null)
  }, [])

  const clearSession = useCallback(() => {
    setSession(null)
    setIsConnectedState(false)
    setPeerName(null)
    setError(null)
  }, [])

  const setIsConnected = useCallback((connected: boolean) => {
    setIsConnectedState(connected)
  }, [])

  const value: SessionContextValue = {
    session,
    isConnected,
    peerName,
    error,
    createSession,
    joinSession,
    clearSession,
    setPeerName,
    setError: setError,
    setIsConnected,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}

