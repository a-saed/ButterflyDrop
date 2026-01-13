import { useEffect, useRef, useCallback, useState } from "react";
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

// Signaling server URL - auto-detects production vs development
const getSignalingUrl = () => {
  // Always check environment variable first
  if (import.meta.env.VITE_SIGNALING_URL) {
    console.log(`🔧 Using signaling URL from env: ${import.meta.env.VITE_SIGNALING_URL}`);
    return import.meta.env.VITE_SIGNALING_URL;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = window.location.hostname;

  // Check if hostname is a local IP address (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  const isLocalIP = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(hostname);
  
  // If it's localhost or local IP, use same hostname with port 8080
  if (hostname === "localhost" || hostname === "127.0.0.1" || isLocalIP) {
    const url = `${protocol}//${hostname}:8080`;
    console.log(`💻 Local development mode, using ${url}`);
    return url;
  }

  // Production mode - use same hostname (assumes signaling on same domain)
  const url = `${protocol}//${hostname}`;
  console.log(`🌐 Production mode detected, using ${url}`);
  return url;
};

const SIGNALING_URL = getSignalingUrl();

interface PeerConnectionState {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  isConnected: boolean;
  isOfferer: boolean;
  iceCandidateQueue: RTCIceCandidateInit[];
  // Queue messages that arrive before handler is set up
  messageQueue: MessageEvent[];
  hasMessageHandler: boolean;
}

/**
 * Snapdrop-style WebRTC hook
 * - Auto-establishes connections when peers join
 * - Keeps connections ready for instant file transfer
 * - No waiting when user clicks "Send"
 */
export function useWebRTC() {
  const {
    session,
    setIsConnected: setSessionConnected,
    setPeers,
    setMyPeerId,
  } = useSession();
  const { setConnectionState, setError: setConnectionError } = useConnection();

  // Map of peer ID -> peer connection state
  const peerConnectionsRef = useRef<Map<string, PeerConnectionState>>(
    new Map()
  );
  const [readyPeers, setReadyPeers] = useState<Set<string>>(new Set());

  const signalingRef = useRef<SignalingClient | null>(null);
  const peerIdRef = useRef<string>(generatePeerId());
  const deviceNameRef = useRef<string>(getDeviceName());
  const deviceTypeRef = useRef<string>(detectDeviceType());
  const hasInitializedRef = useRef(false);
  const previousSessionIdRef = useRef<string | null>(null);
  // Ref to store reconnection callback to avoid circular dependencies
  const reconnectPeerRef = useRef<((peerId: string) => void) | null>(null);

  /**
   * Create peer connection for a specific peer
   */
  const createPeerConnectionForPeer = useCallback(
    (peerId: string, isOfferer: boolean): PeerConnectionState => {
      console.log(
        `🔗 Creating peer connection for ${peerId} (${
          isOfferer ? "offerer" : "answerer"
        })`
      );

      const pc = createPeerConnection();
      const state: PeerConnectionState = {
        pc,
        dataChannel: null,
        isConnected: false,
        isOfferer,
        iceCandidateQueue: [],
        messageQueue: [],
        hasMessageHandler: false,
      };

      console.log(
        `   📊 Peer connection state created for ${peerId} (${
          isOfferer ? "offerer" : "answerer"
        })`
      );

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && signalingRef.current && session) {
          console.log(
            `🧊 Sending ICE candidate to peer ${peerId} (${event.candidate.type})`
          );
          signalingRef.current.send({
            type: "ice-candidate",
            sessionId: session.id,
            peerId: peerId,
            data: event.candidate,
          });
        } else if (!event.candidate) {
          console.log(`🧊 ICE gathering complete for ${peerId}`);
        }
      };

      // Handle connection state changes (complementary to ICE state)
      pc.onconnectionstatechange = () => {
        const connState = pc.connectionState;
        console.log(
          `🔗 Connection state with ${peerId}: ${connState}`
        );
        
        if (connState === "connected") {
          state.isConnected = true;
          setReadyPeers((prev) => new Set(prev).add(peerId));
          console.log(`✅ WebRTC connection ready with ${peerId}`);
        } else if (connState === "connecting") {
          // Still connecting - don't remove from ready peers yet
          console.log(`🔄 Still connecting to ${peerId}...`);
        } else if (connState === "disconnected") {
          // Temporary disconnection
          console.log(`⚠️ Connection disconnected with ${peerId} - waiting for reconnect...`);
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
        } else if (connState === "failed") {
          // Connection failed - attempt reconnection
          console.log(`❌ Connection failed with ${peerId} - attempting reconnection...`);
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
          
          // Attempt to reconnect after a delay
          setTimeout(() => {
            const currentState = peerConnectionsRef.current.get(peerId);
            if (currentState && currentState.pc.connectionState === "failed") {
              console.log(`🔄 Re-initiating connection to ${peerId}...`);
              // Re-initiate connection using ref to avoid circular dependency
              if (reconnectPeerRef.current) {
                reconnectPeerRef.current(peerId);
              }
            }
          }, 3000);
        } else if (connState === "closed") {
          // Connection closed - cleanup
          console.log(`🔒 Connection closed with ${peerId}`);
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
        }
      };

      // Handle ICE connection state - critical for mobile stability
      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState;
        console.log(
          `🧊 ICE connection state with ${peerId}: ${iceState}`
        );
        
        // Handle different ICE states
        if (iceState === "connected" || iceState === "completed") {
          // Connection is good
          state.isConnected = true;
          setReadyPeers((prev) => new Set(prev).add(peerId));
          console.log(`✅ ICE connection established with ${peerId}`);
        } else if (iceState === "disconnected") {
          // Temporary disconnection (common on mobile when screen turns off)
          console.log(`⚠️ ICE disconnected with ${peerId} - may reconnect automatically`);
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
          // Don't destroy connection yet - wait for reconnect or failure
        } else if (iceState === "failed") {
          // Connection failed - attempt reconnection
          console.log(`❌ ICE connection failed with ${peerId} - attempting reconnection...`);
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
          
          // Attempt to reconnect after a delay
          setTimeout(() => {
            const currentState = peerConnectionsRef.current.get(peerId);
            if (currentState && currentState.pc.iceConnectionState === "failed") {
              console.log(`🔄 Attempting to reconnect to ${peerId}...`);
              // Re-initiate connection using ref to avoid circular dependency
              if (reconnectPeerRef.current) {
                reconnectPeerRef.current(peerId);
              }
            }
          }, 2000);
        } else if (iceState === "closed") {
          // Connection closed - cleanup
          console.log(`🔒 ICE connection closed with ${peerId}`);
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
        }
      };

      // Helper to setup data channel handlers
      const setupDataChannelHandlers = (channel: RTCDataChannel, role: string) => {
        // CRITICAL: Set binaryType to arraybuffer for proper binary data handling
        channel.binaryType = "arraybuffer";

        channel.onopen = () => {
          console.log(`✅ Data channel opened with ${peerId} (${role})`);
          state.isConnected = true;
          setReadyPeers((prev) => new Set(prev).add(peerId));
        };

        channel.onclose = () => {
          console.log(`❌ Data channel closed with ${peerId}`);
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
        };

        channel.onerror = (error) => {
          console.error(`❌ Data channel error with ${peerId}:`, error);
        };
        
        // Queue messages until a proper handler is set up
        // This prevents losing messages that arrive before setupReceiver is called
        channel.onmessage = (event) => {
          if (state.hasMessageHandler) {
            // Handler will be replaced by setupReceiver, this shouldn't run
            console.log(`⚠️ Message received but handler should be replaced`);
          } else {
            console.log(`📬 Queueing message for ${peerId} (handler not ready yet)`);
            state.messageQueue.push(event);
          }
        };
      };

      // If we're the offerer, create data channel immediately
      if (isOfferer) {
        const channel = createDataChannel(pc, "file-transfer");
        state.dataChannel = channel;
        setupDataChannelHandlers(channel, "offerer");
      } else {
        // If we're the answerer, wait for data channel from peer
        pc.ondatachannel = (event) => {
          console.log(`📡 Received data channel from ${peerId}`);
          const channel = event.channel;
          state.dataChannel = channel;
          setupDataChannelHandlers(channel, "answerer");
        };
      }

      peerConnectionsRef.current.set(peerId, state);
      return state;
    },
    [session]
  );

  /**
   * Initiate connection to a peer (create offer)
   */
  const initiateConnectionToPeer = useCallback(
    (peerId: string) => {
      if (!session || !signalingRef.current) {
        console.error(
          "❌ Cannot initiate connection: no session or signaling",
          {
            hasSession: !!session,
            hasSignaling: !!signalingRef.current,
          }
        );
        return;
      }

      // Check if already connected and healthy
      const existingState = peerConnectionsRef.current.get(peerId);
      if (existingState) {
        const pc = existingState.pc;
        const isHealthy = 
          pc.connectionState === "connected" && 
          (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed");
        
        if (isHealthy) {
          console.log(`   ✅ Already have healthy connection to ${peerId}, skipping`);
        return;
        } else {
          console.log(`   ⚠️ Existing connection to ${peerId} is unhealthy (${pc.connectionState}/${pc.iceConnectionState}), cleaning up...`);
          // Clean up unhealthy connection
          if (existingState.dataChannel) {
            existingState.dataChannel.close();
          }
          pc.close();
          peerConnectionsRef.current.delete(peerId);
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
        }
      }

      console.log(`🚀 Initiating connection to peer ${peerId}`);

      // Create peer connection as offerer
      const state = createPeerConnectionForPeer(peerId, true);

      // Create and send offer
      state.pc
        .createOffer()
        .then((offer) => {
          console.log(`   📝 Created offer for ${peerId}`);
          return state.pc.setLocalDescription(offer);
        })
        .then(() => {
          console.log(`   ✅ Local description set (offer)`);
          const localDescription = state.pc.localDescription;
          if (!localDescription) {
            throw new Error(
              "Local description is null after setLocalDescription"
            );
          }
          console.log(`📤 Sending offer to peer ${peerId}`);
          signalingRef.current!.send({
            type: "offer",
            sessionId: session!.id,
            peerId: peerId,
            data: localDescription,
          });
          console.log(`   ✅ Offer sent successfully`);
        })
        .catch((error) => {
          console.error(`❌ Failed to create/send offer for ${peerId}:`, error);
          peerConnectionsRef.current.delete(peerId);
        });
    },
    [session, createPeerConnectionForPeer]
  );

  /**
   * Handle incoming offer from a peer
   */
  const handleOffer = useCallback(
    async (peerId: string, offer: RTCSessionDescriptionInit) => {
      if (!session || !signalingRef.current) {
        console.error("❌ Cannot handle offer: no session or signaling");
        return;
      }

      console.log(`📥 Received offer from peer ${peerId}`);

      // Create peer connection as answerer
      const state = createPeerConnectionForPeer(peerId, false);

      try {
        // Set remote description
        await state.pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`✅ Remote description set for ${peerId}`);

        // Process queued ICE candidates
        if (state.iceCandidateQueue.length > 0) {
          console.log(
            `🧊 Processing ${state.iceCandidateQueue.length} queued ICE candidates for ${peerId}`
          );
          for (const candidate of state.iceCandidateQueue) {
            try {
              await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
              console.error(
                `❌ Failed to add queued ICE candidate for ${peerId}:`,
                error
              );
            }
          }
          state.iceCandidateQueue = [];
        }

        // Create and send answer
        const answer = await state.pc.createAnswer();
        await state.pc.setLocalDescription(answer);

        console.log(`📤 Sending answer to peer ${peerId}`);
        signalingRef.current.send({
          type: "answer",
          sessionId: session.id,
          peerId: peerId,
          data: answer,
        });
      } catch (error) {
        console.error(`❌ Failed to handle offer from ${peerId}:`, error);
        peerConnectionsRef.current.delete(peerId);
      }
    },
    [session, createPeerConnectionForPeer]
  );

  /**
   * Handle incoming answer from a peer
   */
  const handleAnswer = useCallback(
    async (peerId: string, answer: RTCSessionDescriptionInit) => {
      console.log(`📥 Received answer from peer ${peerId}`);

      const state = peerConnectionsRef.current.get(peerId);
      if (!state) {
        console.error(
          `❌ No peer connection state found for ${peerId} when handling answer`
        );
        return;
      }

      try {
        await state.pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`✅ Remote description set for ${peerId}`);

        // Process queued ICE candidates
        if (state.iceCandidateQueue.length > 0) {
          console.log(
            `🧊 Processing ${state.iceCandidateQueue.length} queued ICE candidates for ${peerId}`
          );
          for (const candidate of state.iceCandidateQueue) {
            try {
              await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
              console.error(
                `❌ Failed to add queued ICE candidate for ${peerId}:`,
                error
              );
            }
          }
          state.iceCandidateQueue = [];
        }
      } catch (error) {
        console.error(`❌ Failed to handle answer from ${peerId}:`, error);
      }
    },
    []
  );

  /**
   * Handle incoming ICE candidate from a peer
   */
  const handleIceCandidate = useCallback(
    async (peerId: string, candidate: RTCIceCandidateInit) => {
      console.log(`🧊 Received ICE candidate from peer ${peerId}`);

      const state = peerConnectionsRef.current.get(peerId);
      if (!state) {
        console.warn(
          `⚠️ No peer connection found for ${peerId}, ignoring ICE candidate`
        );
        return;
      }

      if (state.pc.remoteDescription) {
        try {
          await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(`✅ Added ICE candidate for ${peerId}`);
        } catch (error) {
          console.error(`❌ Failed to add ICE candidate for ${peerId}:`, error);
        }
      } else {
        console.log(
          `🧊 Queueing ICE candidate for ${peerId} (no remote description yet)`
        );
        state.iceCandidateQueue.push(candidate);
      }
    },
    []
  );

  /**
   * Handle peer list updates - auto-establish connections with new peers
   * Simplified: Both sides always try to connect (polite/impolite pattern)
   */
  const handlePeerListUpdate = useCallback(
    (peers: Array<{ id: string; name: string; deviceType: string }>) => {
      const myId = peerIdRef.current;
      console.log(
        `👥 Peer list updated, processing ${peers.length} total peers`
      );
      console.log(`   My ID: ${myId} (${myId.slice(0, 8)}...)`);
      console.log(
        `   All peers:`,
        peers.map((p) => `${p.name} (${p.id.slice(0, 8)}...)`)
      );

      // Filter out self and add isOnline property
      const otherPeers = peers
        .filter((peer) => peer.id !== myId)
        .map((peer) => ({
          id: peer.id,
          name: peer.name,
          deviceType: peer.deviceType,
          isOnline: true,
        }));
      console.log(
        `🔍 Found ${otherPeers.length} other peers after filtering self`
      );

      if (otherPeers.length === 0) {
        console.log(`   ℹ️ No other peers to connect to`);
        setPeers(otherPeers);
        return;
      }

      // For each peer, establish connection if we don't have one yet
      // Simplified approach: Both sides initiate, we handle collisions gracefully
      otherPeers.forEach((peer) => {
        const alreadyConnected = peerConnectionsRef.current.has(peer.id);

        console.log(
          `🤝 Processing peer: ${peer.name} (${peer.id.slice(0, 8)}...)`
        );
        console.log(`   Already connected: ${alreadyConnected}`);

        if (!alreadyConnected) {
          // Determine if we're "polite" (higher ID = polite, waits for offers)
          // or "impolite" (lower ID = impolite, sends offers immediately)
          const isPolite = myId > peer.id;
          console.log(
            `   🎭 I am ${
              isPolite ? "polite (higher ID)" : "impolite (lower ID)"
            }`
          );

          if (!isPolite) {
            // Impolite peer initiates immediately
            console.log(
              `   ✅ I will initiate connection to ${peer.name} (impolite peer)`
            );
            console.log(
              `   🔍 Debug: session=${!!session}, signaling=${!!signalingRef.current}`
            );
            // Initiate immediately - session is available in this scope
            if (!peerConnectionsRef.current.has(peer.id)) {
              initiateConnectionToPeer(peer.id);
            }
          } else {
            // Polite peer waits for offer, but sets up to receive it
            console.log(
              `   ⏳ I will wait for ${peer.name} to initiate (polite peer)`
            );
          }
        } else {
          console.log(`   ℹ️ Already connected to ${peer.name}`);
        }
      });

      // Update session peers
      setPeers(otherPeers);
    },
    [session, setPeers, initiateConnectionToPeer]
  );

  /**
   * Get data channel for a specific peer (for file transfer)
   */
  const getDataChannelForPeer = useCallback(
    (peerId: string): RTCDataChannel | null => {
      const state = peerConnectionsRef.current.get(peerId);
      if (!state) {
        console.error(`❌ No connection found for peer ${peerId}`);
        return null;
      }

      if (!state.dataChannel || state.dataChannel.readyState !== "open") {
        console.error(
          `❌ Data channel not ready for peer ${peerId} (state: ${state.dataChannel?.readyState})`
        );
        return null;
      }

      return state.dataChannel;
    },
    []
  );

  /**
   * Get queued messages for a peer and mark that handler is installed
   * This should be called when setting up the message handler
   */
  const getQueuedMessagesForPeer = useCallback(
    (peerId: string): MessageEvent[] => {
      const state = peerConnectionsRef.current.get(peerId);
      if (!state) {
        return [];
      }
      
      // Mark that a proper handler is now installed
      state.hasMessageHandler = true;
      
      // Return and clear the queue
      const messages = [...state.messageQueue];
      state.messageQueue = [];
      
      if (messages.length > 0) {
        console.log(`📬 Returning ${messages.length} queued messages for ${peerId}`);
      }
      
      return messages;
    },
    []
  );

  /**
   * Check if peer is ready for file transfer
   */
  const isPeerReady = useCallback(
    (peerId: string): boolean => {
      return readyPeers.has(peerId);
    },
    [readyPeers]
  );

  /**
   * Initialize signaling and join network
   */
  const initialize = useCallback(async () => {
    if (!session || hasInitializedRef.current) {
      return;
    }

    hasInitializedRef.current = true;
    const myId = peerIdRef.current;

    console.log(
      `🦋 Initializing session ${session.id} as ${
        deviceNameRef.current
      } (peer ${myId.slice(0, 8)}...)`
    );
    console.log(`\n📋 To invite others:`);
    console.log(`   1. Copy the session URL from the top of the page`);
    console.log(`   2. OR scan the QR code with another device`);
    console.log(`   3. Make sure devices are on the same network`);
    console.log(`   ⏳ Waiting for peers to join...\n`);

    try {
      setConnectionState("connecting");

      // CRITICAL: Store my peer ID FIRST before any async operations
      // This ensures SessionContext has myPeerId before peer list arrives
      console.log(
        `🆔 Setting my peer ID FIRST: ${myId} (${myId.slice(0, 8)}...)`
      );
      setMyPeerId(myId);

      // Small delay to ensure state update propagates
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Connect to signaling server
      console.log(`🔌 Connecting to signaling server: ${SIGNALING_URL}`);
      console.log(`   Environment variable: ${import.meta.env.VITE_SIGNALING_URL || "not set"}`);
      const signaling = new SignalingClient(SIGNALING_URL);
      signalingRef.current = signaling;

      try {
        await signaling.connect();
        console.log("✅ Connected to signaling server");
      } catch (error) {
        console.error("❌ Failed to connect to signaling server:", error);
        console.error(`   URL attempted: ${SIGNALING_URL}`);
        console.error(`   Make sure the signaling server is running on port 8080`);
        throw error; // Re-throw to be caught by outer try-catch
      }

      // Join the session
      signaling.send({
        type: "session-join",
        sessionId: session.id,
        peerId: myId,
        peerName: deviceNameRef.current,
        deviceType: deviceTypeRef.current,
      });

      // Handle signaling server reconnection
      signaling.on("close", () => {
        console.log("⚠️ Signaling server disconnected - will attempt to reconnect");
        setConnectionState("connecting");
      });

      signaling.on("open", () => {
        console.log("✅ Signaling server reconnected");
        // Rejoin session if we were already in one
        if (session && peerIdRef.current) {
          console.log("🔄 Rejoining session after signaling reconnection...");
          signaling.send({
            type: "session-join",
            sessionId: session.id,
            peerId: peerIdRef.current,
            peerName: deviceNameRef.current,
            deviceType: deviceTypeRef.current,
          });
        }
      });

      // Handle signaling messages
      signaling.on("message", async (data: unknown) => {
        const message = data as SignalingMessage;
        console.log(
          `📨 Received signaling message: ${message.type}`,
          message.peerId ? `from ${message.peerId.slice(0, 8)}...` : ""
        );

        if (message.type === "offer" && message.peerId && message.data) {
          console.log(
            `   Processing offer from ${message.peerId.slice(0, 8)}...`
          );
          await handleOffer(
            message.peerId,
            message.data as RTCSessionDescriptionInit
          );
        } else if (
          message.type === "answer" &&
          message.peerId &&
          message.data
        ) {
          console.log(
            `   Processing answer from ${message.peerId.slice(0, 8)}...`
          );
          await handleAnswer(
            message.peerId,
            message.data as RTCSessionDescriptionInit
          );
        } else if (
          message.type === "ice-candidate" &&
          message.peerId &&
          message.data
        ) {
          await handleIceCandidate(
            message.peerId,
            message.data as RTCIceCandidateInit
          );
        } else if (message.type === "session-join" && message.peers) {
          const otherPeerCount = message.peers.filter(
            (p) => p.id !== myId
          ).length;
          console.log("✅ Joined session, received peer list");
          console.log(`   Total peers in session: ${message.peers.length}`);
          console.log(`   Other peers (excluding self): ${otherPeerCount}`);

          if (otherPeerCount === 0) {
            console.log(
              `\n💡 No other peers yet! Share the session URL to invite others.\n`
            );
          } else {
            console.log(
              `\n🎉 Found ${otherPeerCount} other peer(s)! Starting connection...\n`
            );
          }

          handlePeerListUpdate(message.peers);
          setConnectionState("connected");
          setSessionConnected(true);
        } else if (message.type === "peer-list" && message.peers) {
          const otherPeerCount = message.peers.filter(
            (p) => p.id !== myId
          ).length;
          console.log("🔄 Peer list updated");
          console.log(`   Total peers in session: ${message.peers.length}`);
          console.log(`   Other peers (excluding self): ${otherPeerCount}`);

          if (otherPeerCount === 0) {
            console.log(`   ℹ️ All peers left. Waiting for others to join...`);
          }

          handlePeerListUpdate(message.peers);
        } else if (message.type === "error") {
          console.error("❌ Signaling error:", message.error);
          setConnectionError(message.error || "Unknown error");
          setConnectionState("failed");
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
    setSessionConnected,
    setConnectionError,
    setMyPeerId,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    handlePeerListUpdate,
  ]);

  /**
   * Cleanup all connections
   */
  const cleanup = useCallback(() => {
    console.log("🧹 Cleaning up all WebRTC connections...");

    // Close all peer connections
    peerConnectionsRef.current.forEach((state, peerId) => {
      console.log(`   Closing connection to ${peerId}`);
      if (state.dataChannel) {
        state.dataChannel.close();
      }
      state.pc.close();
    });
    peerConnectionsRef.current.clear();
    setReadyPeers(new Set());

    // Disconnect signaling
    if (signalingRef.current) {
      if (session) {
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
    setConnectionState("disconnected");
    setSessionConnected(false);
  }, [session, setConnectionState, setSessionConnected]);

  // Store reconnection callback in ref (useEffect to avoid render-time ref update)
  useEffect(() => {
    reconnectPeerRef.current = initiateConnectionToPeer;
  }, [initiateConnectionToPeer]);

  // Handle visibility changes (mobile screen on/off)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("📱 Page became visible - checking connections...");
        
        // Check signaling connection
        if (signalingRef.current && !signalingRef.current.isConnected()) {
          console.log("🔄 Signaling disconnected, reconnecting...");
          if (session && peerIdRef.current) {
            initialize();
          }
        }
        
        // Check all peer connections and reconnect if needed
        peerConnectionsRef.current.forEach((state, peerId) => {
          if (
            state.pc.iceConnectionState === "failed" ||
            state.pc.iceConnectionState === "disconnected" ||
            state.pc.connectionState === "failed" ||
            state.pc.connectionState === "disconnected"
          ) {
            console.log(`🔄 Reconnecting to peer ${peerId.slice(0, 8)}...`);
            // Small delay to avoid race conditions
            setTimeout(() => {
              if (reconnectPeerRef.current) {
                reconnectPeerRef.current(peerId);
              }
            }, 1000);
          }
        });
      } else {
        console.log("📱 Page became hidden (screen off or tab switch)");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    // Also handle page focus/blur for additional mobile support
    const handleFocus = () => {
      console.log("📱 Page focused - checking connections...");
      handleVisibilityChange();
    };
    
    window.addEventListener("focus", handleFocus);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [session, initialize, initiateConnectionToPeer]);

  // Initialize when session is ready
  useEffect(() => {
    const currentSessionId = session?.id ?? null;
    
    // Only re-initialize if session ID actually changed
    if (currentSessionId !== previousSessionIdRef.current) {
      previousSessionIdRef.current = currentSessionId;
      
    if (!session) {
        // Use setTimeout to avoid calling setState synchronously in effect
        const timeoutId = setTimeout(() => {
      cleanup();
        }, 0);
        return () => clearTimeout(timeoutId);
    }

    initialize();
      return () => {
        cleanup();
      };
    }
  }, [session, cleanup, initialize]);

  return {
    getDataChannelForPeer,
    getQueuedMessagesForPeer,
    isPeerReady,
    readyPeers: Array.from(readyPeers),
  };
}
