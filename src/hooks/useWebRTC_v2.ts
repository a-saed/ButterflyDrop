import { useEffect, useRef, useCallback, useState } from "react";
// import { createPeerConnection, createDataChannel } from "@/lib/webrtc/config";
import { SignalingClient } from "@/services/signaling";
import { useSession } from "@/contexts/SessionContext";
import { useConnection } from "@/contexts/ConnectionContext";
import {
  getDeviceName,
  detectDeviceType,
  generatePeerId,
} from "@/lib/deviceUtils";
import type { SignalingMessage } from "@/types/webrtc";

// Signaling server URL - auto-detects production vs development
const getSignalingUrl = () => {
  // 1. Check environment variable (highest priority)
  if (import.meta.env.VITE_SIGNALING_URL) {
    return import.meta.env.VITE_SIGNALING_URL;
  }

  // 2. Auto-detect based on current location
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = window.location.hostname;

  // 3. Production: use same hostname with wss://
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    console.log(`🌐 Production mode detected, using ${protocol}//${hostname}`);
    return `${protocol}//${hostname}`;
  }

  // 4. Local development: default to localhost:8080
  console.log("💻 Local development mode, using ws://localhost:8080");
  return "ws://localhost:8080";
};

const SIGNALING_URL = getSignalingUrl();

/**
 * Modern P2P WebRTC hook - all peers are equal
 * Any peer can send files to any other peer (like AirDrop)
 */
export function useWebRTC() {
  const {
    session,
    setIsConnected: setSessionConnected,
    setPeers,
    setMyPeerId,
  } = useSession();
  const { setConnectionState, setError: setConnectionError } = useConnection();

  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const [peerConnection, setPeerConnection] =
    useState<RTCPeerConnection | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const signalingRef = useRef<SignalingClient | null>(null);
  const peerIdRef = useRef<string>(generatePeerId());
  const deviceNameRef = useRef<string>(getDeviceName());
  const deviceTypeRef = useRef<string>(detectDeviceType());
  const hasInitializedRef = useRef(false);

  /**
   * Initialize signaling and join network
   */
  const initialize = useCallback(async () => {
    if (!session || hasInitializedRef.current) {
      return;
    }

    hasInitializedRef.current = true;
    console.log(
      `Initializing session ${session.id} as ${deviceNameRef.current} (peer ${peerIdRef.current})`,
    );

    try {
      setConnectionState("connecting");

      // Connect to signaling server
      const signaling = new SignalingClient(SIGNALING_URL);
      signalingRef.current = signaling;

      console.log(`🔌 Connecting to signaling server: ${SIGNALING_URL}`);
      await signaling.connect();
      console.log("✅ Connected to signaling server");

      // Store my peer ID
      setMyPeerId(peerIdRef.current);

      // Join the P2P network (all peers are equal)
      console.log(
        `Joining P2P network ${session.id} as ${deviceNameRef.current} (${peerIdRef.current})`,
      );

      // Use session-join for everyone (no sender/receiver distinction)
      signaling.send({
        type: "session-join",
        sessionId: session.id,
        peerId: peerIdRef.current,
        peerName: deviceNameRef.current,
        deviceType: deviceTypeRef.current,
      });

      // Handle signaling messages
      signaling.on("message", async (data: unknown) => {
        const message = data as SignalingMessage;
        console.log(`Got signaling message: ${message.type}`, message);

        if (message.type === "session-join" && message.peers) {
          // Successfully joined P2P network
          console.log("✅ Joined P2P network, received peers:", message.peers);
          // Deduplicate peers (server should handle this, but safety check)
          const uniquePeers = message.peers.filter(
            (peer, index, self) =>
              index === self.findIndex((p) => p.id === peer.id),
          );
          console.log(`📡 Setting ${uniquePeers.length} unique peers`);
          setPeers(uniquePeers);
          setConnectionState("connected");
          setSessionConnected(true);
        } else if (message.type === "peer-list" && message.peers) {
          // Peer list updated (someone joined/left)
          console.log("🔄 Peer list updated:", message.peers);
          // Deduplicate peers
          const uniquePeers = message.peers.filter(
            (peer, index, self) =>
              index === self.findIndex((p) => p.id === peer.id),
          );
          console.log(`📡 Updating to ${uniquePeers.length} unique peers`);
          setPeers(uniquePeers);
          setConnectionState("connected");
          setSessionConnected(true);
        } else if (message.type === "error") {
          console.error("❌ Signaling error:", message.error);
          setConnectionError(message.error || "Unknown error");
          setConnectionState("failed");
        } else {
          console.log(
            `ℹ️ Unhandled signaling message: ${message.type}`,
            message,
          );
        }
      });
    } catch (error) {
      console.error("Failed to initialize:", error);
      setConnectionError("Failed to connect to signaling server");
      setConnectionState("failed");
      hasInitializedRef.current = false;
    }
  }, [
    session,
    setConnectionState,
    setPeers,
    setSessionConnected,
    setConnectionError,
    setMyPeerId,
  ]);

  /**
   * Cleanup
   */
  const cleanup = useCallback(() => {
    console.log("Cleaning up WebRTC resources...");

    if (dataChannel) {
      dataChannel.close();
      setDataChannel(null);
    }
    if (peerConnection) {
      peerConnection.close();
      setPeerConnection(null);
    }
    if (signalingRef.current) {
      // Send leave message
      if (session) {
        console.log(`Sending session-leave for session ${session.id}`);
        signalingRef.current.send({
          type: "session-leave",
          sessionId: session.id,
          peerId: peerIdRef.current,
        });
      }
      signalingRef.current.disconnect();
      signalingRef.current = null;
    }

    hasInitializedRef.current = false;
    setIsConnected(false);
    setConnectionState("disconnected");
    setSessionConnected(false);
  }, [
    session,
    dataChannel,
    peerConnection,
    setConnectionState,
    setSessionConnected,
  ]);

  // Initialize when session is ready
  useEffect(() => {
    if (!session) {
      cleanup();
      return;
    }

    console.log(
      `🦋 Initializing P2P session ${session.id} (modern approach - no roles)`,
    );
    initialize();
    return cleanup;
  }, [session]); // Only depend on session, not cleanup/initialize to prevent loops

  return {
    dataChannel,
    peerConnection,
    isConnected,
  };
}
