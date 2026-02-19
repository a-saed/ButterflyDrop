import type { WebRTCConfig } from "@/types/webrtc";

/**
 * WebRTC peer connection configuration.
 *
 * Ice server strategy:
 *  - Multiple Google STUN endpoints (different anycast IPs) for redundancy
 *  - Cloudflare STUN for diversity (separate network path)
 *  - Metered open-relay STUN as an additional fallback
 *
 * iceCandidatePoolSize: pre-gathers candidates before negotiation starts so
 * the first offer/answer round-trip can include candidates immediately,
 * reducing connection setup time noticeably on mobile.
 *
 * bundlePolicy "max-bundle": all media/data tracks share a single transport,
 * which means fewer ICE component pairs to check and faster connection.
 *
 * rtcpMuxPolicy "require": RTCP is multiplexed onto the RTP port — halves
 * the number of ports that need to be opened through the NAT.
 */
export const defaultWebRTCConfig: WebRTCConfig = {
  iceServers: [
    // Google STUN — two separate anycast clusters for redundancy
    {
      urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
    },
    {
      urls: ["stun:stun2.l.google.com:19302", "stun:stun3.l.google.com:19302"],
    },
    // Cloudflare STUN — different network path, good global coverage
    { urls: "stun:stun.cloudflare.com:3478" },
    // Metered open-relay — additional fallback with broad coverage
    { urls: "stun:stun.relay.metered.ca:80" },
  ],
};

/**
 * Full RTCConfiguration used when creating peer connections.
 * Extends the base ICE servers with transport-level optimisations.
 */
export const rtcConfiguration: RTCConfiguration = {
  ...defaultWebRTCConfig,
  /**
   * Pre-gather 10 ICE candidates in the background as soon as the
   * RTCPeerConnection is created.  When createOffer() is called the
   * candidates are already available, so they travel in the first
   * signaling round-trip instead of trickling in afterwards.
   */
  iceCandidatePoolSize: 10,
  /**
   * Negotiate all tracks/channels over a single DTLS transport.
   * Fewer ICE component pairs → faster candidate checking.
   */
  bundlePolicy: "max-bundle",
  /**
   * Require RTCP multiplexing — halves the number of UDP ports that must
   * be punched through the NAT.
   */
  rtcpMuxPolicy: "require",
};

/**
 * Create an RTCPeerConnection with the optimised configuration.
 * Pass a partial override to customise for specific use-cases (e.g. tests).
 */
export function createPeerConnection(
  override?: Partial<RTCConfiguration>,
): RTCPeerConnection {
  return new RTCPeerConnection(
    override ? { ...rtcConfiguration, ...override } : rtcConfiguration,
  );
}

/**
 * Create a reliable, ordered data channel for file transfer.
 *
 * "ordered: true"  — chunks arrive in sequence; no need for sequence-number
 *                    reassembly in the application layer.
 * No maxRetransmits / maxPacketLifeTime — defaults to TCP-like reliable mode.
 */
export function createDataChannel(
  peerConnection: RTCPeerConnection,
  label: string = "file-transfer",
): RTCDataChannel {
  return peerConnection.createDataChannel(label, {
    ordered: true,
    // Omitting maxRetransmits and maxPacketLifeTime keeps the channel in
    // fully-reliable mode (equivalent to TCP semantics over SCTP).
  });
}
