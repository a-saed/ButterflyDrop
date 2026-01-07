import { useEffect, useRef, useCallback } from 'react'
import { createPeerConnection, createDataChannel } from '@/lib/webrtc/config'
import { SignalingClient } from '@/services/signaling'
import { useSession } from '@/contexts/SessionContext'
import { useConnection } from '@/contexts/ConnectionContext'
import type { SignalingMessage } from '@/types/webrtc'

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:8080'

export function useWebRTC() {
  const { session, setPeerName, setIsConnected: setSessionConnected, setError: setSessionError } = useSession()
  const { setConnectionState, setError: setConnectionError } = useConnection()
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const signalingRef = useRef<SignalingClient | null>(null)
  const isInitiatorRef = useRef(false)

  /**
   * Initialize WebRTC connection as sender (initiator)
   */
  const initializeAsSender = useCallback(async () => {
    if (!session) return

    try {
      setConnectionState('connecting')
      
      // Create peer connection
      const pc = createPeerConnection()
      peerConnectionRef.current = pc

      // Create data channel
      const dc = createDataChannel(pc, 'file-transfer')
      dataChannelRef.current = dc

      // Set up data channel handlers
      dc.onopen = () => {
        setConnectionState('connected')
        setSessionConnected(true)
        setPeerName('Peer Device')
      }

      dc.onerror = (error) => {
        console.error('Data channel error:', error)
        setConnectionError('Data channel error occurred')
        setConnectionState('failed')
      }

      dc.onclose = () => {
        setConnectionState('closed')
      }

      // Set up ICE candidate handler
      pc.onicecandidate = (event) => {
        if (event.candidate && signalingRef.current?.isConnected()) {
          signalingRef.current.send({
            type: 'ice-candidate',
            sessionId: session.id,
            data: event.candidate.toJSON(),
          })
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'connected' || state === 'connecting') {
          setConnectionState('connecting')
        } else if (state === 'connected') {
          setConnectionState('connected')
        } else if (state === 'failed' || state === 'disconnected') {
          setConnectionState('failed')
        } else if (state === 'closed') {
          setConnectionState('closed')
        }
      }

      // Create offer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // Connect to signaling server
      const signaling = new SignalingClient(SIGNALING_URL)
      signalingRef.current = signaling

      await signaling.connect()

      // Send offer
      signaling.send({
        type: 'offer',
        sessionId: session.id,
        data: offer,
      })

      // Handle answer
      signaling.on('message', (message: SignalingMessage) => {
        if (message.type === 'answer' && message.data) {
          pc.setRemoteDescription(new RTCSessionDescription(message.data as RTCSessionDescriptionInit))
        } else if (message.type === 'ice-candidate' && message.data) {
          pc.addIceCandidate(new RTCIceCandidate(message.data as RTCIceCandidateInit))
        }
      })

      isInitiatorRef.current = true
    } catch (error) {
      console.error('Failed to initialize as sender:', error)
      setConnectionError('Failed to establish connection')
      setConnectionState('failed')
    }
  }, [session, setConnectionState, setPeerName, setConnectionError])

  /**
   * Initialize WebRTC connection as receiver
   */
  const initializeAsReceiver = useCallback(async () => {
    if (!session) return

    try {
      setConnectionState('connecting')

      // Connect to signaling server first
      const signaling = new SignalingClient(SIGNALING_URL)
      signalingRef.current = signaling

      await signaling.connect()

      // Send join message
      signaling.send({
        type: 'session-join',
        sessionId: session.id,
      })

      // Wait for offer
      signaling.on('message', async (message: SignalingMessage) => {
        if (message.type === 'offer' && message.data) {
          // Create peer connection
          const pc = createPeerConnection()
          peerConnectionRef.current = pc

          // Set up data channel handler (receiver side)
          pc.ondatachannel = (event) => {
            const dc = event.channel
            dataChannelRef.current = dc

            dc.onopen = () => {
              setConnectionState('connected')
              setSessionConnected(true)
              setPeerName('Sender Device')
            }

            dc.onerror = (error) => {
              console.error('Data channel error:', error)
              setConnectionError('Data channel error occurred')
              setConnectionState('failed')
            }

            dc.onclose = () => {
              setConnectionState('closed')
            }
          }

          // Set up ICE candidate handler
          pc.onicecandidate = (event) => {
            if (event.candidate && signaling.isConnected()) {
              signaling.send({
                type: 'ice-candidate',
                sessionId: session.id,
                data: event.candidate.toJSON(),
              })
            }
          }

          pc.onconnectionstatechange = () => {
            const state = pc.connectionState
            if (state === 'connected' || state === 'connecting') {
              setConnectionState('connecting')
            } else if (state === 'connected') {
              setConnectionState('connected')
            } else if (state === 'failed' || state === 'disconnected') {
              setConnectionState('failed')
            } else if (state === 'closed') {
              setConnectionState('closed')
            }
          }

          // Set remote description and create answer
          await pc.setRemoteDescription(new RTCSessionDescription(message.data as RTCSessionDescriptionInit))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)

          // Send answer
          signaling.send({
            type: 'answer',
            sessionId: session.id,
            data: answer,
          })
        } else if (message.type === 'ice-candidate' && message.data && peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(message.data as RTCIceCandidateInit))
        }
      })

      isInitiatorRef.current = false
    } catch (error) {
      console.error('Failed to initialize as receiver:', error)
      setConnectionError('Failed to establish connection')
      setConnectionState('failed')
    }
  }, [session, setConnectionState, setPeerName, setConnectionError])

  /**
   * Cleanup WebRTC resources
   */
  const cleanup = useCallback(() => {
    if (dataChannelRef.current) {
      dataChannelRef.current.close()
      dataChannelRef.current = null
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }
    if (signalingRef.current) {
      signalingRef.current.disconnect()
      signalingRef.current = null
    }
    setConnectionState('disconnected')
    setSessionConnected(false)
  }, [setConnectionState, setSessionConnected])

  // Initialize connection based on session role
  useEffect(() => {
    if (!session) {
      cleanup()
      return
    }

    if (session.role === 'sender') {
      initializeAsSender()
    } else {
      initializeAsReceiver()
    }

    return cleanup
  }, [session, initializeAsSender, initializeAsReceiver, cleanup, setSessionConnected])

  return {
    dataChannel: dataChannelRef.current,
    peerConnection: peerConnectionRef.current,
    isConnected: peerConnectionRef.current?.connectionState === 'connected',
  }
}

