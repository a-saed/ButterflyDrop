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
import { SIGNALING_URL } from "@/lib/signalingConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PeerConnectionState {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  isConnected: boolean;
  isOfferer: boolean;
  iceCandidateQueue: RTCIceCandidateInit[];
  /** Messages buffered before the app-level handler is registered. */
  messageQueue: MessageEvent[];
  hasMessageHandler: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true when the connection is fully established and healthy. */
function isConnectionHealthy(state: PeerConnectionState): boolean {
  const { pc } = state;
  return (
    (pc.connectionState === "connected" ||
      pc.iceConnectionState === "connected" ||
      pc.iceConnectionState === "completed") &&
    state.dataChannel?.readyState === "open"
  );
}

/**
 * Returns true when a connection exists in the map but is clearly broken and
 * should be torn down and re-established.
 */
function isConnectionBroken(state: PeerConnectionState): boolean {
  const { pc } = state;
  return (
    pc.connectionState === "failed" ||
    pc.connectionState === "closed" ||
    pc.iceConnectionState === "failed" ||
    pc.iceConnectionState === "closed"
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useWebRTC
 *
 * Manages the full WebRTC lifecycle:
 *  - Connects to the signaling server and joins the session
 *  - Auto-establishes peer connections when remote peers appear
 *  - Implements the "perfect negotiation" pattern to handle offer glare
 *  - Debounces transient ICE "disconnected" events (5 s grace) so the UI
 *    doesn't flicker yellow during brief network hiccups
 *  - Falls back to self-initiation when the "polite" peer hasn't received an
 *    offer within 6 s (covers the case where the first message was lost)
 *  - Runs a periodic health scan every 30 s to re-initiate broken connections
 *  - Cleans up all resources deterministically when the session ends
 *
 * ⚠️  This hook must be instantiated exactly ONCE via <WebRTCProvider>.
 *     Do NOT call useWebRTC() directly in components or other hooks — use
 *     useWebRTCContext() instead to share the single instance.
 */
export function useWebRTC() {
  const {
    session,
    setIsConnected: setSessionConnected,
    setPeers,
    setMyPeerId,
  } = useSession();
  const { setConnectionState, setError: setConnectionError } = useConnection();

  // ─── Refs ───────────────────────────────────────────────────────────────────

  /** Map of peerId → per-peer WebRTC state. */
  const peerConnectionsRef = useRef<Map<string, PeerConnectionState>>(
    new Map(),
  );
  const [readyPeers, setReadyPeers] = useState<Set<string>>(new Set());

  const signalingRef = useRef<SignalingClient | null>(null);

  // Stable device identity — generated/retrieved from localStorage once.
  const peerIdRef = useRef<string>(generatePeerId());
  const deviceNameRef = useRef<string>(getDeviceName());
  const deviceTypeRef = useRef<string>(detectDeviceType());

  /** Prevents initialize() from running more than once per session. */
  const hasInitializedRef = useRef(false);
  /**
   * Tracks the last session ID we acted on so the main useEffect only fires
   * when the *value* of the session ID changes, not when the session object
   * reference is replaced.
   */
  const previousSessionIdRef = useRef<string | null>(null);

  /**
   * Ref-stored callback for reconnecting to a peer.
   * Stored as a ref to break the circular dep:
   *   initiateConnectionToPeer → handlePeerListUpdate → initiateConnectionToPeer
   */
  const reconnectPeerRef = useRef<((peerId: string) => void) | null>(null);

  /**
   * Per-peer timers that cancel a polite-peer fallback initiation if the
   * expected offer arrives before the timeout fires.
   */
  const politeTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  /**
   * Per-peer timers that debounce the ICE "disconnected" → readyPeers removal.
   * ICE "disconnected" is transient and often self-heals within a few seconds,
   * so we wait 5 s before actually marking the peer as not-ready.
   */
  const iceDisconnectTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  /** Handle for the 30-second periodic health-scan interval. */
  const healthScanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // ─── createPeerConnectionForPeer ────────────────────────────────────────────

  const createPeerConnectionForPeer = useCallback(
    (peerId: string, isOfferer: boolean): PeerConnectionState => {
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

      // ── ICE candidate forwarding ─────────────────────────────────────────
      pc.onicecandidate = (event) => {
        if (event.candidate && signalingRef.current && session) {
          signalingRef.current.send({
            type: "ice-candidate",
            sessionId: session.id,
            peerId,
            data: event.candidate,
          });
        }
      };

      // ── Connection state ─────────────────────────────────────────────────
      // We use onconnectionstatechange as the primary signal for DTLS/SCTP
      // connection health, and oniceconnectionstatechange for ICE-level events.
      pc.onconnectionstatechange = () => {
        const connState = pc.connectionState;

        if (connState === "connected") {
          // Cancel any pending ICE-disconnect debounce timer — we're back
          const timer = iceDisconnectTimersRef.current.get(peerId);
          if (timer !== undefined) {
            clearTimeout(timer);
            iceDisconnectTimersRef.current.delete(peerId);
          }
          state.isConnected = true;
          setReadyPeers((prev) => new Set(prev).add(peerId));
        } else if (connState === "failed" || connState === "closed") {
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });

          if (connState === "failed") {
            // Schedule a reconnect attempt after a short back-off
            setTimeout(() => {
              const current = peerConnectionsRef.current.get(peerId);
              if (current?.pc.connectionState === "failed") {
                reconnectPeerRef.current?.(peerId);
              }
            }, 3_000);
          }
        }
        // "connecting" / "disconnected" — let ICE state machine handle it
      };

      // ── ICE connection state ─────────────────────────────────────────────
      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState;

        if (iceState === "connected" || iceState === "completed") {
          // Cancel any pending disconnect debounce
          const timer = iceDisconnectTimersRef.current.get(peerId);
          if (timer !== undefined) {
            clearTimeout(timer);
            iceDisconnectTimersRef.current.delete(peerId);
          }
          state.isConnected = true;
          setReadyPeers((prev) => new Set(prev).add(peerId));
        } else if (iceState === "disconnected") {
          // ── Debounced removal ────────────────────────────────────────────
          // "disconnected" is transient on mobile (screen lock, brief network
          // drop, Wi-Fi roam).  Give ICE 5 s to self-heal before removing
          // the peer from readyPeers, preventing the false yellow-spinner flash.
          if (!iceDisconnectTimersRef.current.has(peerId)) {
            const timer = setTimeout(() => {
              iceDisconnectTimersRef.current.delete(peerId);
              const current = peerConnectionsRef.current.get(peerId);
              if (current?.pc.iceConnectionState === "disconnected") {
                state.isConnected = false;
                setReadyPeers((prev) => {
                  const next = new Set(prev);
                  next.delete(peerId);
                  return next;
                });
              }
            }, 5_000);
            iceDisconnectTimersRef.current.set(peerId, timer);
          }
        } else if (iceState === "failed") {
          // Clear any disconnect debounce — it's definitely gone now
          const timer = iceDisconnectTimersRef.current.get(peerId);
          if (timer !== undefined) {
            clearTimeout(timer);
            iceDisconnectTimersRef.current.delete(peerId);
          }
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });

          // Attempt ICE restart before a full teardown
          setTimeout(() => {
            const current = peerConnectionsRef.current.get(peerId);
            if (current?.pc.iceConnectionState === "failed") {
              reconnectPeerRef.current?.(peerId);
            }
          }, 2_000);
        } else if (iceState === "closed") {
          const timer = iceDisconnectTimersRef.current.get(peerId);
          if (timer !== undefined) {
            clearTimeout(timer);
            iceDisconnectTimersRef.current.delete(peerId);
          }
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
        }
      };

      // ── Data channel setup ───────────────────────────────────────────────
      const setupDataChannelHandlers = (channel: RTCDataChannel) => {
        channel.binaryType = "arraybuffer";

        channel.onopen = () => {
          state.isConnected = true;
          setReadyPeers((prev) => new Set(prev).add(peerId));
        };

        channel.onclose = () => {
          state.isConnected = false;
          setReadyPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
        };

        channel.onerror = (error) => {
          console.error(`Data channel error with ${peerId}:`, error);
        };

        // Buffer messages until the app-level handler (setupReceiver) installs
        // its own onmessage — avoids losing the first chunk of a transfer.
        channel.onmessage = (event) => {
          if (!state.hasMessageHandler) {
            state.messageQueue.push(event);
          }
        };
      };

      if (isOfferer) {
        const channel = createDataChannel(pc, "file-transfer");
        state.dataChannel = channel;
        setupDataChannelHandlers(channel);
      } else {
        pc.ondatachannel = (event) => {
          const channel = event.channel;
          state.dataChannel = channel;
          setupDataChannelHandlers(channel);
        };
      }

      peerConnectionsRef.current.set(peerId, state);
      return state;
    },
    [session],
  );

  // ─── initiateConnectionToPeer ────────────────────────────────────────────────

  /**
   * Creates an RTCPeerConnection for `peerId` as the offerer, creates and
   * sends an SDP offer via the signaling server.
   *
   * Idempotent — skips silently if a healthy connection already exists.
   * Tears down any unhealthy connection in the map before proceeding.
   */
  const initiateConnectionToPeer = useCallback(
    (peerId: string) => {
      if (!session || !signalingRef.current) {
        console.error("Cannot initiate connection: no session or signaling");
        return;
      }

      // ── Skip if already healthy ──────────────────────────────────────────
      const existingState = peerConnectionsRef.current.get(peerId);
      if (existingState) {
        if (isConnectionHealthy(existingState)) return;

        // Tear down the broken connection before creating a fresh one
        existingState.dataChannel?.close();
        existingState.pc.close();
        peerConnectionsRef.current.delete(peerId);
        setReadyPeers((prev) => {
          const next = new Set(prev);
          next.delete(peerId);
          return next;
        });
      }

      const state = createPeerConnectionForPeer(peerId, true);

      state.pc
        .createOffer()
        .then((offer) => state.pc.setLocalDescription(offer))
        .then(() => {
          const localDescription = state.pc.localDescription;
          if (!localDescription) throw new Error("localDescription is null");

          signalingRef.current!.send({
            type: "offer",
            sessionId: session!.id,
            peerId,
            data: localDescription,
          });
        })
        .catch((error) => {
          console.error(`Failed to create/send offer to ${peerId}:`, error);
          peerConnectionsRef.current.delete(peerId);
        });
    },
    [session, createPeerConnectionForPeer],
  );

  // ─── handleOffer — perfect negotiation ──────────────────────────────────────

  /**
   * Handles an incoming SDP offer using the "perfect negotiation" pattern:
   *
   *  - The "polite" peer (higher string ID) is willing to roll back its own
   *    pending offer and accept the incoming one.
   *  - The "impolite" peer (lower string ID) ignores incoming offers when it
   *    already has one in flight (collision → impolite side wins).
   *
   * This eliminates glare without any external coordination.
   */
  const handleOffer = useCallback(
    async (peerId: string, offer: RTCSessionDescriptionInit) => {
      if (!session || !signalingRef.current) {
        console.error("Cannot handle offer: no session or signaling");
        return;
      }

      // Cancel the polite-peer fallback timeout if it's pending — the remote
      // side did send us an offer, so we no longer need to self-initiate.
      const politeTimer = politeTimeoutsRef.current.get(peerId);
      if (politeTimer !== undefined) {
        clearTimeout(politeTimer);
        politeTimeoutsRef.current.delete(peerId);
      }

      // Perfect negotiation: are we the "polite" peer for this pair?
      const myId = peerIdRef.current;
      const isPolite = myId > peerId;

      let state = peerConnectionsRef.current.get(peerId);

      // Detect offer collision (glare): we have a pending offer of our own
      const offerCollision =
        offer.type === "offer" &&
        state &&
        (state.pc.signalingState !== "stable" || state.isOfferer);

      if (offerCollision) {
        if (!isPolite) {
          // Impolite: our offer wins — discard the incoming offer
          return;
        }
        // Polite: roll back our pending offer so we can accept theirs
        try {
          await state!.pc.setLocalDescription({ type: "rollback" });
        } catch {
          // Some browsers don't support explicit rollback; tear down and redo
          state!.dataChannel?.close();
          state!.pc.close();
          peerConnectionsRef.current.delete(peerId);
          state = undefined;
        }
      }

      // Create the peer connection (as answerer) if it doesn't exist yet
      if (!state) {
        state = createPeerConnectionForPeer(peerId, false);
      }

      try {
        await state.pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Flush any ICE candidates that arrived before the remote description
        for (const candidate of state.iceCandidateQueue) {
          await state.pc
            .addIceCandidate(new RTCIceCandidate(candidate))
            .catch(() => {});
        }
        state.iceCandidateQueue = [];

        const answer = await state.pc.createAnswer();
        await state.pc.setLocalDescription(answer);

        signalingRef.current.send({
          type: "answer",
          sessionId: session.id,
          peerId,
          data: answer,
        });
      } catch (error) {
        console.error(`Failed to handle offer from ${peerId}:`, error);
        peerConnectionsRef.current.delete(peerId);
      }
    },
    [session, createPeerConnectionForPeer],
  );

  // ─── handleAnswer ────────────────────────────────────────────────────────────

  const handleAnswer = useCallback(
    async (peerId: string, answer: RTCSessionDescriptionInit) => {
      const state = peerConnectionsRef.current.get(peerId);
      if (!state) return;

      // Guard against stale answers (e.g. from a previous negotiation round)
      if (state.pc.signalingState !== "have-local-offer") return;

      try {
        await state.pc.setRemoteDescription(new RTCSessionDescription(answer));

        // Flush queued ICE candidates
        for (const candidate of state.iceCandidateQueue) {
          await state.pc
            .addIceCandidate(new RTCIceCandidate(candidate))
            .catch(() => {});
        }
        state.iceCandidateQueue = [];
      } catch (error) {
        console.error(`Failed to handle answer from ${peerId}:`, error);
      }
    },
    [],
  );

  // ─── handleIceCandidate ──────────────────────────────────────────────────────

  const handleIceCandidate = useCallback(
    async (peerId: string, candidate: RTCIceCandidateInit) => {
      const state = peerConnectionsRef.current.get(peerId);
      if (!state) return;

      if (state.pc.remoteDescription) {
        await state.pc
          .addIceCandidate(new RTCIceCandidate(candidate))
          .catch((err) =>
            console.error(`Failed to add ICE candidate for ${peerId}:`, err),
          );
      } else {
        // Queue until setRemoteDescription is called
        state.iceCandidateQueue.push(candidate);
      }
    },
    [],
  );

  // ─── handlePeerListUpdate ────────────────────────────────────────────────────

  /**
   * Called whenever the signaling server sends a peer-list or session-join.
   *
   * For each remote peer:
   *  1. If a healthy connection exists → do nothing.
   *  2. If a broken connection exists → tear it down and re-initiate.
   *  3. If no connection exists:
   *     - Impolite peer (lower ID) → initiate immediately.
   *     - Polite peer   (higher ID) → wait 6 s for the remote offer, then
   *       self-initiate as a fallback (handles lost messages / asymmetric joins).
   */
  const handlePeerListUpdate = useCallback(
    (peers: Array<{ id: string; name: string; deviceType: string }>) => {
      const myId = peerIdRef.current;

      const otherPeers = peers
        .filter((peer) => peer.id !== myId)
        .map((peer) => ({
          id: peer.id,
          name: peer.name,
          deviceType: peer.deviceType,
          isOnline: true,
        }));

      // Update the session peer list regardless of connection state
      setPeers(otherPeers);

      if (otherPeers.length === 0) return;

      otherPeers.forEach((peer) => {
        const existingState = peerConnectionsRef.current.get(peer.id);

        if (existingState) {
          if (isConnectionHealthy(existingState)) {
            // Already good — nothing to do
            return;
          }
          if (isConnectionBroken(existingState)) {
            // Broken — tear down and fall through to reconnect
            existingState.dataChannel?.close();
            existingState.pc.close();
            peerConnectionsRef.current.delete(peer.id);
            setReadyPeers((prev) => {
              const next = new Set(prev);
              next.delete(peer.id);
              return next;
            });
            // fall through to the "new peer" logic below
          } else {
            // Mid-negotiation (connecting/checking) — leave it alone
            return;
          }
        }

        // ── New (or freshly cleaned) peer ──────────────────────────────────
        const isPolite = myId > peer.id;

        if (!isPolite) {
          // Impolite: send the offer right away
          initiateConnectionToPeer(peer.id);
        } else {
          // Polite: give the remote side 6 s to send us an offer first.
          // If it doesn't arrive (lost message, asymmetric join, etc.) we
          // self-initiate as a fallback so we're never stuck waiting forever.
          if (!politeTimeoutsRef.current.has(peer.id)) {
            const timer = setTimeout(() => {
              politeTimeoutsRef.current.delete(peer.id);
              // Only self-initiate if we still don't have a connection
              if (!peerConnectionsRef.current.has(peer.id)) {
                initiateConnectionToPeer(peer.id);
              }
            }, 6_000);
            politeTimeoutsRef.current.set(peer.id, timer);
          }
        }
      });
    },
    [setPeers, initiateConnectionToPeer],
  );

  // ─── Public accessors ────────────────────────────────────────────────────────

  const getDataChannelForPeer = useCallback(
    (peerId: string): RTCDataChannel | null => {
      const state = peerConnectionsRef.current.get(peerId);
      if (!state?.dataChannel || state.dataChannel.readyState !== "open") {
        return null;
      }
      return state.dataChannel;
    },
    [],
  );

  const getQueuedMessagesForPeer = useCallback(
    (peerId: string): MessageEvent[] => {
      const state = peerConnectionsRef.current.get(peerId);
      if (!state) return [];

      state.hasMessageHandler = true;
      const messages = [...state.messageQueue];
      state.messageQueue = [];
      return messages;
    },
    [],
  );

  const isPeerReady = useCallback(
    (peerId: string): boolean => readyPeers.has(peerId),
    [readyPeers],
  );

  // ─── initialize ──────────────────────────────────────────────────────────────

  const initialize = useCallback(async () => {
    if (!session || hasInitializedRef.current) return;

    hasInitializedRef.current = true;
    const myId = peerIdRef.current;

    try {
      setConnectionState("connecting");

      // Register our peer ID with the session context *before* the first
      // async operation so it's available when the peer-list arrives.
      setMyPeerId(myId);

      // Tiny yield so the state update above can propagate before we send
      // the session-join (avoids a "myPeerId not set yet" warning).
      await new Promise((resolve) => setTimeout(resolve, 50));

      // ── Connect to signaling server ──────────────────────────────────────
      const signaling = new SignalingClient(SIGNALING_URL);
      signalingRef.current = signaling;

      try {
        await signaling.connect();
      } catch (error) {
        console.error("Failed to connect to signaling server:", error);
        throw error;
      }

      // ── Join the session ─────────────────────────────────────────────────
      const sendJoin = () => {
        signaling.send({
          type: "session-join",
          sessionId: session.id,
          peerId: myId,
          peerName: deviceNameRef.current,
          deviceType: deviceTypeRef.current,
        });
      };

      sendJoin();

      // Re-join after every signaling reconnect (the server forgets sessions
      // on restart; re-joining puts us back in the peer list).
      signaling.on("open", () => {
        sendJoin();
        setConnectionState("connecting");
      });

      signaling.on("close", () => {
        setConnectionState("connecting");
      });

      // ── Signaling message dispatcher ─────────────────────────────────────
      signaling.on("message", async (data: unknown) => {
        const message = data as SignalingMessage;

        if (message.type === "offer" && message.peerId && message.data) {
          await handleOffer(
            message.peerId,
            message.data as RTCSessionDescriptionInit,
          );
        } else if (
          message.type === "answer" &&
          message.peerId &&
          message.data
        ) {
          await handleAnswer(
            message.peerId,
            message.data as RTCSessionDescriptionInit,
          );
        } else if (
          message.type === "ice-candidate" &&
          message.peerId &&
          message.data
        ) {
          await handleIceCandidate(
            message.peerId,
            message.data as RTCIceCandidateInit,
          );
        } else if (message.type === "session-join" && message.peers) {
          handlePeerListUpdate(message.peers);
          setConnectionState("connected");
          setSessionConnected(true);
        } else if (message.type === "peer-list" && message.peers) {
          handlePeerListUpdate(message.peers);
        } else if (message.type === "error") {
          console.error("Signaling error:", message.error);
          setConnectionError(message.error ?? "Unknown signaling error");
          setConnectionState("failed");
        }
      });

      // ── Periodic health scan ─────────────────────────────────────────────
      // Every 30 s: re-initiate any connections that have gone broken without
      // triggering a state-change event (can happen on some mobile browsers).
      healthScanIntervalRef.current = setInterval(() => {
        if (!signalingRef.current?.isConnected()) return;

        peerConnectionsRef.current.forEach((state, peerId) => {
          if (isConnectionBroken(state)) {
            reconnectPeerRef.current?.(peerId);
          }
        });
      }, 30_000);
    } catch (error) {
      console.error("WebRTC init failed:", error);
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

  // ─── cleanup ─────────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    // Stop health scan
    if (healthScanIntervalRef.current !== null) {
      clearInterval(healthScanIntervalRef.current);
      healthScanIntervalRef.current = null;
    }

    // Cancel all polite-peer fallback timers
    politeTimeoutsRef.current.forEach((timer) => clearTimeout(timer));
    politeTimeoutsRef.current.clear();

    // Cancel all ICE-disconnect debounce timers
    iceDisconnectTimersRef.current.forEach((timer) => clearTimeout(timer));
    iceDisconnectTimersRef.current.clear();

    // Close all peer connections
    peerConnectionsRef.current.forEach((state) => {
      state.dataChannel?.close();
      state.pc.close();
    });
    peerConnectionsRef.current.clear();
    setReadyPeers(new Set());

    // Disconnect signaling (intentional — suppresses reconnect loop)
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

  // ─── Effects ─────────────────────────────────────────────────────────────────

  // Keep the reconnect ref in sync without adding it to dependency arrays.
  useEffect(() => {
    reconnectPeerRef.current = initiateConnectionToPeer;
  }, [initiateConnectionToPeer]);

  // ── Visibility / focus recovery ─────────────────────────────────────────────
  // When the user returns to the tab (mobile lock/unlock, alt-tab, etc.),
  // check whether the signaling and peer connections are still alive and
  // recover any that dropped while the page was hidden.
  useEffect(() => {
    const recover = () => {
      if (document.visibilityState !== "visible") return;

      const sig = signalingRef.current;

      if (!sig || !sig.isConnected()) {
        // Signaling is gone — reset the initialized flag so initialize()
        // will actually run (the guard check is hasInitializedRef.current).
        if (sig) {
          // SignalingClient exists but is not connected; let its own internal
          // reconnect loop handle it — don't double-initialize.
          return;
        }
        // No client at all: full re-init
        hasInitializedRef.current = false;
        initialize();
        return;
      }

      // Signaling is up — inspect individual peer connections
      peerConnectionsRef.current.forEach((state, peerId) => {
        if (isConnectionBroken(state)) {
          setTimeout(() => {
            reconnectPeerRef.current?.(peerId);
          }, 1_000);
        }
      });
    };

    document.addEventListener("visibilitychange", recover);
    window.addEventListener("focus", recover);

    return () => {
      document.removeEventListener("visibilitychange", recover);
      window.removeEventListener("focus", recover);
    };
  }, [initialize]);

  // ── Session lifecycle ────────────────────────────────────────────────────────
  // Only re-initialize (or cleanup) when the session *ID* actually changes.
  // Using previousSessionIdRef prevents spurious re-runs caused by the session
  // object reference being replaced while the ID stays the same.
  useEffect(() => {
    const currentSessionId = session?.id ?? null;

    if (currentSessionId === previousSessionIdRef.current) return;
    previousSessionIdRef.current = currentSessionId;

    if (!session) {
      // Session ended — defer cleanup out of the synchronous effect body
      const t = setTimeout(() => cleanup(), 0);
      return () => clearTimeout(t);
    }

    initialize();
    return () => {
      cleanup();
    };
  }, [session, cleanup, initialize]);

  // ─── Return ──────────────────────────────────────────────────────────────────

  return {
    getDataChannelForPeer,
    getQueuedMessagesForPeer,
    isPeerReady,
    readyPeers: Array.from(readyPeers),
  };
}
