import { useState, useEffect, useCallback } from 'react'

interface Peer {
  id: string
  name: string
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'laptop'
  isOnline: boolean
  lastSeen?: number
}

/**
 * Hook for discovering peers on the network
 * This is a mock implementation - will be replaced with real WebRTC peer discovery
 */
export function usePeerDiscovery() {
  const [peers, setPeers] = useState<Peer[]>([])
  const [isScanning, setIsScanning] = useState(true)

  useEffect(() => {
    // Simulate peer discovery
    const timer = setTimeout(() => {
      setPeers([
        {
          id: '1',
          name: 'MacBook Pro',
          deviceType: 'laptop',
          isOnline: true,
          lastSeen: Date.now(),
        },
        {
          id: '2',
          name: 'iPhone 15',
          deviceType: 'mobile',
          isOnline: true,
          lastSeen: Date.now(),
        },
        {
          id: '3',
          name: 'iPad Air',
          deviceType: 'tablet',
          isOnline: true,
          lastSeen: Date.now(),
        },
      ])
      setIsScanning(false)
    }, 1500)

    return () => clearTimeout(timer)
  }, [])

  const refreshPeers = useCallback(() => {
    setIsScanning(true)
    // Simulate refresh
    setTimeout(() => {
      setIsScanning(false)
    }, 1000)
  }, [])

  return {
    peers,
    isScanning,
    refreshPeers,
  }
}

