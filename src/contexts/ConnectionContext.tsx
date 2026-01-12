import { createContext, useContext, useState, type ReactNode } from "react";
import type { ConnectionState } from "@/types/webrtc";

interface ConnectionContextValue {
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;
  error: string | null;
  setError: (error: string | null) => void;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(
  undefined,
);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [error, setError] = useState<string | null>(null);

  const value: ConnectionContextValue = {
    connectionState,
    setConnectionState,
    error,
    setError,
  };

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionContextValue {
  const context = useContext(ConnectionContext);
  if (context === undefined) {
    throw new Error("useConnection must be used within a ConnectionProvider");
  }
  return context;
}
