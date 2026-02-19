import { PeerAvatar } from "./PeerAvatar";
import { Wifi } from "lucide-react";
import { useMemo } from "react";

interface Peer {
  id: string;
  name: string;
  deviceType: "desktop" | "mobile" | "tablet" | "laptop";
  isOnline: boolean;
  lastSeen?: number;
}

interface PeerNetworkProps {
  peers: Peer[];
  selectedPeerId?: string;
  onPeerSelect?: (peerId: string) => void;
  hasFiles?: boolean;
  readyPeers?: string[];
  onSyncWithPeer?: (peerId: string) => void;
}

/**
 * Generate random but consistent positions for peers
 */
function generatePeerPositions(
  peers: Peer[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Define safe zones (avoid edges and center)
  const safeZones = [
    { x: 20, y: 25 },
    { x: 80, y: 25 },
    { x: 15, y: 50 },
    { x: 85, y: 50 },
    { x: 30, y: 70 },
    { x: 70, y: 70 },
    { x: 50, y: 80 },
    { x: 25, y: 35 },
    { x: 75, y: 35 },
  ];

  peers.forEach((peer, index) => {
    const position = safeZones[index % safeZones.length];
    positions.set(peer.id, position);
  });

  return positions;
}

export function PeerNetwork({
  peers,
  selectedPeerId,
  onPeerSelect,
  hasFiles,
  readyPeers = [],
  onSyncWithPeer,
}: PeerNetworkProps) {
  const peerPositions = useMemo(() => generatePeerPositions(peers), [peers]);

  if (peers.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="relative mb-4 inline-block">
            <Wifi className="h-16 w-16 text-muted-foreground/50" />
            <div className="absolute inset-0 bg-muted-foreground/10 rounded-full blur-xl animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground mb-1">
            Scanning for devices...
          </p>
          <p className="text-xs text-muted-foreground/70">
            Make sure other devices are on the same network
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {peers.map((peer) => {
        const position = peerPositions.get(peer.id) || { x: 50, y: 50 };
        const isReady = readyPeers.includes(peer.id);
        return (
          <PeerAvatar
            key={peer.id}
            peer={peer}
            position={position}
            isSelected={selectedPeerId === peer.id}
            onClick={() => onPeerSelect?.(peer.id)}
            hasFiles={hasFiles && selectedPeerId === peer.id}
            isReady={isReady}
            onSyncClick={
              onSyncWithPeer && isReady
                ? () => onSyncWithPeer(peer.id)
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
