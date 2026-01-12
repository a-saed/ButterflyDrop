import type { WebRTCConfig } from '@/types/webrtc'

/**
 * Default WebRTC configuration with STUN servers
 */
export const defaultWebRTCConfig: WebRTCConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Add TURN servers here if needed for production
  ],
}

/**
 * Create RTCPeerConnection with default config
 */
export function createPeerConnection(config?: Partial<WebRTCConfig>): RTCPeerConnection {
  const finalConfig = config
    ? { ...defaultWebRTCConfig, ...config }
    : defaultWebRTCConfig

  return new RTCPeerConnection(finalConfig)
}

/**
 * Create data channel for file transfer
 * CRITICAL: Use reliable mode for file transfers
 */
export function createDataChannel(
  peerConnection: RTCPeerConnection,
  label: string = 'file-transfer'
): RTCDataChannel {
  // For file transfers, we MUST have reliable delivery
  // Don't specify maxRetransmits or maxPacketLifeTime for reliable mode
  return peerConnection.createDataChannel(label, {
    ordered: true,
    // NO maxRetransmits: 0 - that disables retransmissions!
    // Reliable mode is default when these are omitted
  })
}

