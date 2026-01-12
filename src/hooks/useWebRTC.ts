import { useEffect, useRef, useCallback } from "react";
import { createPeerConnection, createDataChannel } from "@/lib/webrtc/config";
import { SignalingClient } from "@/services/signaling";
import { useSession } from "@/contexts/SessionContext";
import { useConnection } from "@/contexts/ConnectionContext";
import {
  getDeviceName,
  detectDeviceType,
  generatePeerId,
} from "@/lib/deviceUtils";
import type { SignalingMessage } from "@/types/webrtc";

const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL || "ws://localhost:8080";

export function useWebRTC() {
  const {
    session,
    peerName,
    setPeerName,
    setIsConnected: setSessionConnected,
    setPeers,
    setMyPeerId,
  } = useSession();
  const { setConnectionState, setError: setConnectionError } = useConnection();

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const signalingRef = useRef<SignalingClient | null>(null);
  const isInitiatorRef = useRef(false);
  const isInitializedRef = useRef(false); // Prevent double initialization
  const peerIdRef = useRef<string>(generatePeerId());
  const deviceNameRef = useRef<string>(getDeviceName());
  const deviceTypeRef = useRef<string>(detectDeviceType());

  /**
   * Initialize WebRTC connection as sender (initiator)
   */
  const initializeAsSender = useCallback(async () => {
    if (!session) return;
    if (isInitializedRef.current) {
      console.log("Already initialized, skipping...");
      return;
    }

    isInitializedRef.current = true;

    try {
      setConnectionState("connecting");

      // Create peer connection
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      // Create data channel
      const dc = createDataChannel(pc, "file-transfer");
      dataChannelRef.current = dc;

      // Set up data channel handlers
      dc.onopen = () => {
        setConnectionState("connected");
        setSessionConnected(true);
        setPeerName("Peer Device");
      };

      dc.onerror = (error) => {
        console.error("Data channel error:", error);
        setConnectionError("Data channel error occurred");
        setConnectionState("failed");
      };

      dc.onclose = () => {
        setConnectionState("closed");
      };

      // Set up ICE candidate handler
      pc.onicecandidate = (event) => {
        if (event.candidate && signalingRef.current?.isConnected()) {
          signalingRef.current.send({
            type: "ice-candidate",
            sessionId: session.id,
            data: event.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "connecting") {
          setConnectionState("connecting");
        } else if (state === "connected") {
          setConnectionState("connected");
        } else if (state === "failed" || state === "disconnected") {
          setConnectionState("failed");
        } else if (state === "closed") {
          setConnectionState("closed");
        }
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Connect to signaling server
      const signaling = new SignalingClient(SIGNALING_URL);
      signalingRef.current = signaling;

      await signaling.connect();

      console.log(
        `Creating session ${session.id} as ${deviceNameRef.current} (peer ID: ${peerIdRef.current})`,
      );

      // Store my peer ID
      setMyPeerId(peerIdRef.current);

      // Create session first with device info
      signaling.send({
        type: "session-create",
        sessionId: session.id,
        peerId: peerIdRef.current,
        peerName: deviceNameRef.current,
        deviceType: deviceTypeRef.current,
      });

      // Wait a bit for session creation
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send offer
      signaling.send({
        type: "offer",
        sessionId: session.id,
        data: offer,
      });

      // Handle messages
      signaling.on("message", (data: unknown) => {
        const message = data as SignalingMessage;
        console.log(`Sender got message: ${message.type}`, message);

        if (message.type === "answer" && message.data) {
          pc.setRemoteDescription(
            new RTCSessionDescription(
              message.data as RTCSessionDescriptionInit,
            ),
          );
        } else if (message.type === "ice-candidate" && message.data) {
          pc.addIceCandidate(
            new RTCIceCandidate(message.data as RTCIceCandidateInit),
          );
        } else if (message.type === "peer-list" && message.peers) {
          // Handle peer list updates
          console.log("Peer list updated:", message.peers);
          setPeers(message.peers);
          // Set first peer name if available
          if (message.peers.length > 0 && !peerName) {
            setPeerName(message.peers[0].name);
          }
        } else if (message.type === "session-create" && message.peers) {
          // Handle peer list from session creation confirmation
          console.log("Peers in network (from create):", message.peers);
          setPeers(message.peers);
          if (message.peers.length > 0) {
            setPeerName(message.peers[0].name);
          }
        } else if (message.type === "session-join" && message.peerName) {
          // Receiver joined - update peer name if available
          setPeerName(message.peerName);
        }
      });

      isInitiatorRef.current = true;
    } catch (error) {
      console.error("Failed to initialize as sender:", error);
      setConnectionError("Failed to establish connection");
      setConnectionState("failed");
    }
  }, [
    session,
    setConnectionState,
    setPeerName,
    setSessionConnected,
    setConnectionError,
  ]);

  /**
   * Initialize WebRTC connection as receiver
   */
  const initializeAsReceiver = useCallback(async () => {
    if (!session) return;
    if (isInitializedRef.current) {
      console.log("Already initialized, skipping...");
      return;
    }

    isInitializedRef.current = true;

    try {
      setConnectionState("connecting");

      // Connect to signaling server first
      const signaling = new SignalingClient(SIGNALING_URL);
      signalingRef.current = signaling;

      await signaling.connect();

      console.log(
        `Joining session ${session.id} as ${deviceNameRef.current} (peer ID: ${peerIdRef.current})`,
      );

      // Store my peer ID
      setMyPeerId(peerIdRef.current);

      // Send join message with device info
      signaling.send({
        type: "session-join",
        sessionId: session.id,
        peerId: peerIdRef.current,
        peerName: deviceNameRef.current,
        deviceType: deviceTypeRef.current,
      });

      // Wait for messages
      signaling.on("message", async (data: unknown) => {
        const message = data as SignalingMessage;
        if (message.type === "peer-list" && message.peers) {
          // Handle peer list updates
          console.log("Peer list updated:", message.peers);
          // Set first peer name if available
          if (message.peers.length > 0) {
            setPeerName(message.peers[0].name);
          }
        } else if (message.type === "offer" && message.data) {
          // Create peer connection
          const pc = createPeerConnection();
          peerConnectionRef.current = pc;

          // Set up data channel handler (receiver side)
          pc.ondatachannel = (event) => {
            const dc = event.channel;
            dataChannelRef.current = dc;

            dc.onopen = () => {
              setConnectionState("connected");
              setSessionConnected(true);
              setPeerName("Sender Device");
            };

            dc.onerror = (error) => {
              console.error("Data channel error:", error);
              setConnectionError("Data channel error occurred");
              setConnectionState("failed");
            };

            dc.onclose = () => {
              setConnectionState("closed");
            };
          };

          // Set up ICE candidate handler
          pc.onicecandidate = (event) => {
            if (event.candidate && signaling.isConnected()) {
              signaling.send({
                type: "ice-candidate",
                sessionId: session.id,
                data: event.candidate.toJSON(),
              });
            }
          };

          pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === "connecting") {
              setConnectionState("connecting");
            } else if (state === "connected") {
              setConnectionState("connected");
            } else if (state === "failed" || state === "disconnected") {
              setConnectionState("failed");
            } else if (state === "closed") {
              setConnectionState("closed");
            }
          };

          // Set remote description and create answer
          await pc.setRemoteDescription(
            new RTCSessionDescription(
              message.data as RTCSessionDescriptionInit,
            ),
          );
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          // Send answer
          signaling.send({
            type: "answer",
            sessionId: session.id,
            data: answer,
          });
        } else if (
          message.type === "ice-candidate" &&
          message.data &&
          peerConnectionRef.current
        ) {
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(message.data as RTCIceCandidateInit),
          );
        } else if (message.type === "session-create" && message.peers) {
          // Handle peer list from session creation
          console.log("Peers in network:", message.peers);
          setPeers(message.peers);
          if (message.peers.length > 0) {
            setPeerName(message.peers[0].name);
          }
        } else if (message.type === "session-join" && message.peers) {
          // Handle peer list from join
          console.log("Peers in network:", message.peers);
          setPeers(message.peers);
          if (message.peers.length > 0) {
            setPeerName(message.peers[0].name);
          }
        }
      });

      isInitiatorRef.current = false;
    } catch (error) {
      console.error("Failed to initialize as receiver:", error);
      setConnectionError("Failed to establish connection");
      setConnectionState("failed");
    }
  }, [
    session,
    setConnectionState,
    setPeerName,
    setSessionConnected,
    setConnectionError,
  ]);

  /**
   * Cleanup WebRTC resources
   */
  const cleanup = useCallback(() => {
    console.log("Cleaning up WebRTC resources...");
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (signalingRef.current) {
      signalingRef.current.disconnect();
      signalingRef.current = null;
    }
    isInitializedRef.current = false; // Reset initialization flag
    setConnectionState("disconnected");
    setSessionConnected(false);
  }, [setConnectionState, setSessionConnected]);

  // Initialize connection based on session role
  useEffect(() => {
    if (!session) {
      cleanup();
      return;
    }

    console.log(
      `Initializing WebRTC as ${session.role} for session ${session.id}`,
    );

    if (session.role === "peer") {
      initializeAsSender();
    } else {
      // Legacy compatibility - treat all as peers now
      initializeAsSender();
    }

    return cleanup;
  }, [
    session,
    initializeAsSender,
    initializeAsReceiver,
    cleanup,
    setSessionConnected,
  ]);

  return {
    dataChannel: dataChannelRef.current,
    peerConnection: peerConnectionRef.current,
    isConnected: peerConnectionRef.current?.connectionState === "connected",
  };
}
