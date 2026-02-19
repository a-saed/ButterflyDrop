import { createContext, useContext, type ReactNode } from "react";
import { useWebRTC } from "@/hooks/useWebRTC_v2";

/**
 * The shape of values exposed by the WebRTC context.
 * Mirrors the return type of useWebRTC() exactly.
 */
interface WebRTCContextValue {
  getDataChannelForPeer: (peerId: string) => RTCDataChannel | null;
  getQueuedMessagesForPeer: (peerId: string) => MessageEvent[];
  isPeerReady: (peerId: string) => boolean;
  readyPeers: string[];
}

const WebRTCContext = createContext<WebRTCContextValue | undefined>(undefined);

/**
 * WebRTCProvider
 *
 * Mounts useWebRTC() exactly ONCE for the entire app tree.
 * Any component or hook that needs WebRTC capabilities should
 * call useWebRTCContext() instead of calling useWebRTC() directly.
 *
 * Calling useWebRTC() in multiple places (e.g. AppContent + useFolderSync)
 * creates independent hook instances, each with their own WebSocket connection
 * to the signaling server, their own hasInitializedRef, and their own peer-ID
 * registration — leading to duplicate connections and render-loop bugs.
 */
export function WebRTCProvider({ children }: { children: ReactNode }) {
  const webrtc = useWebRTC();

  return (
    <WebRTCContext.Provider value={webrtc}>{children}</WebRTCContext.Provider>
  );
}

/**
 * useWebRTCContext
 *
 * Consume the single shared WebRTC instance.
 * Must be used inside <WebRTCProvider>.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useWebRTCContext(): WebRTCContextValue {
  const context = useContext(WebRTCContext);
  if (context === undefined) {
    throw new Error(
      "useWebRTCContext must be used inside <WebRTCProvider>. " +
        "Make sure WebRTCProvider wraps your component tree in App.tsx.",
    );
  }
  return context;
}
