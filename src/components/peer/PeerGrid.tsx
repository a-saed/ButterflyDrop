import { PeerCard } from './PeerCard'
import { Wifi } from 'lucide-react'

interface Peer {
  id: string
  name: string
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'laptop'
  isOnline: boolean
  lastSeen?: number
}

interface PeerGridProps {
  peers: Peer[]
  selectedPeerId?: string
  onPeerSelect?: (peerId: string) => void
  hasFiles?: boolean
}

export function PeerGrid({ peers, selectedPeerId, onPeerSelect, hasFiles }: PeerGridProps) {
  const onlinePeers = peers.filter(p => p.isOnline)
  const offlinePeers = peers.filter(p => !p.isOnline)

  if (peers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="relative mb-4">
          <Wifi className="h-16 w-16 text-muted-foreground/50" />
          <div className="absolute inset-0 bg-muted-foreground/10 rounded-full blur-xl animate-pulse" />
        </div>
        <p className="text-sm text-muted-foreground mb-1">Scanning for devices...</p>
        <p className="text-xs text-muted-foreground/70">
          Make sure other devices are on the same network
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Online Peers */}
      {onlinePeers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Available ({onlinePeers.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {onlinePeers.map((peer) => (
              <PeerCard
                key={peer.id}
                peer={peer}
                isSelected={selectedPeerId === peer.id}
                onClick={() => onPeerSelect?.(peer.id)}
                hasFiles={hasFiles && selectedPeerId === peer.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Offline Peers */}
      {offlinePeers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Offline ({offlinePeers.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {offlinePeers.map((peer) => (
              <PeerCard
                key={peer.id}
                peer={peer}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

