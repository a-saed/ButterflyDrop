import { PeerAvatar } from "./PeerAvatar";
import { QrCode, Link } from "lucide-react";
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
 * Generate consistent positions for peers — kept in the upper 55 % of the
 * viewport so they never overlap with the bottom action panel.
 */
function generatePeerPositions(
  peers: Peer[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Safe zones: horizontally spread, vertically capped at ~55 %
  const safeZones = [
    { x: 50, y: 30 }, // 1 peer  — centre
    { x: 30, y: 28 }, // 2 peers — left
    { x: 70, y: 28 }, //         — right
    { x: 20, y: 35 }, // 3 peers — far-left
    { x: 50, y: 25 }, //         — top-centre
    { x: 80, y: 35 }, //         — far-right
    { x: 15, y: 48 }, // 4+
    { x: 40, y: 42 },
    { x: 60, y: 42 },
    { x: 85, y: 48 },
  ];

  peers.forEach((peer, index) => {
    const zone = safeZones[index % safeZones.length];
    positions.set(peer.id, zone);
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
      <div className="absolute inset-0 flex items-center justify-center pb-48">
        <div className="flex flex-col items-center gap-6 text-center max-w-sm px-6">
          {/* Animated waiting icon */}
          <div className="relative">
            <div className="h-20 w-20 rounded-full bg-muted/40 border border-border/50 flex items-center justify-center">
              <svg
                viewBox="0 0 48 48"
                className="h-10 w-10 text-muted-foreground/60"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                {/* Butterfly wings */}
                <path
                  d="M24 24 C18 16, 8 14, 10 24 C8 34, 18 32, 24 24"
                  className="animate-pulse"
                  style={{ animationDelay: "0ms" }}
                />
                <path
                  d="M24 24 C30 16, 40 14, 38 24 C40 34, 30 32, 24 24"
                  className="animate-pulse"
                  style={{ animationDelay: "150ms" }}
                />
                <circle cx="24" cy="24" r="2" fill="currentColor" />
              </svg>
            </div>
            {/* Pulsing rings */}
            <div className="absolute inset-0 rounded-full border border-primary/20 animate-ping opacity-40" />
            <div
              className="absolute inset-[-8px] rounded-full border border-primary/10 animate-ping opacity-20"
              style={{ animationDelay: "0.5s" }}
            />
          </div>

          {/* Text */}
          <div className="space-y-2">
            <p className="text-base font-semibold text-foreground">
              Waiting for a device to connect
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Share your link or QR code with another device — once they open
              it, you'll appear connected here instantly.
            </p>
          </div>

          {/* Quick hints */}
          <div className="flex flex-col sm:flex-row items-center gap-3 text-xs text-muted-foreground/70">
            <div className="flex items-center gap-1.5">
              <Link className="h-3.5 w-3.5" />
              <span>Copy link from the header</span>
            </div>
            <span className="hidden sm:inline">·</span>
            <div className="flex items-center gap-1.5">
              <QrCode className="h-3.5 w-3.5" />
              <span>Or scan a QR code</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      {peers.map((peer) => {
        const position = peerPositions.get(peer.id) ?? { x: 50, y: 35 };
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
