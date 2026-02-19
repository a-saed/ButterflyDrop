import { useMemo } from "react";
import { useSession } from "@/contexts/SessionContext";
import { useConnection } from "@/contexts/ConnectionContext";

export interface Peer {
  id: string;
  name: string;
  deviceType: "desktop" | "mobile" | "tablet" | "laptop";
  isOnline: boolean;
  lastSeen?: number;
}

/**
 * Modern P2P peer discovery hook
 * Note: Filtering of self is done in useWebRTC_v2 before peers reach here
 * This hook just converts PeerInfo to Peer format
 */
export function usePeerDiscovery() {
  const { session, peers: networkPeers } = useSession();
  const { connectionState } = useConnection();

  // Convert networkPeers to Peer interface
  // Filtering is already done in useWebRTC_v2, so we just transform here
  const peers = useMemo<Peer[]>(() => {
    if (!session) {
      return [];
    }

    if (networkPeers.length === 0) {
      return [];
    }

    // Convert PeerInfo to Peer interface
    // Self should already be filtered out by useWebRTC_v2
    return networkPeers.map((peerInfo) => ({
      id: peerInfo.id,
      name: peerInfo.name,
      deviceType: peerInfo.deviceType as Peer["deviceType"],
      isOnline: peerInfo.isOnline,
    }));
  }, [session, networkPeers]);

  // Modern P2P scanning state
  const isScanning = useMemo(() => {
    if (!session) {
      return false;
    }

    // Show scanning while connecting to P2P network or no peers discovered yet
    return (
      connectionState === "connecting" ||
      (connectionState === "connected" && networkPeers.length === 0)
    );
  }, [session, connectionState, networkPeers.length]);

  return {
    peers,
    isScanning,
    refreshPeers: () => {
      // In modern P2P, peers are automatically discovered via signaling
    },
  };
}
