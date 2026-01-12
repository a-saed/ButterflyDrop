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
    console.log(`[usePeerDiscovery] 🔍 Processing peers:`);
    console.log(`  - session: ${session?.id || "none"}`);
    console.log(`  - networkPeers: ${networkPeers.length}`);
    console.log(`  - connectionState: ${connectionState}`);

    if (!session) {
      return [];
    }

    if (networkPeers.length === 0) {
      console.log("📡 No peers available yet");
      return [];
    }

    // Convert PeerInfo to Peer interface
    // Self should already be filtered out by useWebRTC_v2
    const peerList = networkPeers.map((peerInfo) => ({
      id: peerInfo.id,
      name: peerInfo.name,
      deviceType: peerInfo.deviceType as Peer["deviceType"],
      isOnline: peerInfo.isOnline,
      lastSeen: Date.now(),
    }));

    console.log(
      `✅ Returning ${peerList.length} peers:`,
      peerList.map((p) => `${p.name} (${p.id.slice(0, 8)}...)`),
    );

    return peerList;
  }, [session, networkPeers, connectionState]);

  // Modern P2P scanning state
  const isScanning = useMemo(() => {
    if (!session) {
      return false;
    }

    // Show scanning while connecting to P2P network or no peers discovered yet
    const scanning =
      connectionState === "connecting" ||
      (connectionState === "connected" && networkPeers.length === 0);

    console.log(
      `[usePeerDiscovery] 📡 isScanning: ${scanning} (state=${connectionState}, peers=${networkPeers.length})`,
    );
    return scanning;
  }, [session, connectionState, networkPeers.length]);

  return {
    peers,
    isScanning,
    refreshPeers: () => {
      console.log("🔄 Manual peer refresh requested (automatic in P2P mode)");
      // In modern P2P, peers are automatically discovered via signaling
    },
  };
}
