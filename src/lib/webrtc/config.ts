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
 */
export function createDataChannel(
  peerConnection: RTCPeerConnection,
  label: string = 'file-transfer'
): RTCDataChannel {
  return peerConnection.createDataChannel(label, {
    ordered: true,
    maxRetransmits: 0,
  })
}

