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
 * Discovers peers in the same network with proper deduplication
 * All peers are equal - no sender/receiver distinction
 */
export function usePeerDiscovery() {
  const { session, peers: networkPeers, myPeerId } = useSession();
  const { connectionState } = useConnection();

  // Modern P2P peer discovery with robust deduplication
  const peers = useMemo<Peer[]>(() => {
    console.log(`[usePeerDiscovery] 🔍 Starting P2P peer discovery:`);
    console.log(`  - session exists: ${!!session}`);
    console.log(`  - session ID: ${session?.id}`);
    console.log(`  - networkPeers count: ${networkPeers.length}`);
    console.log(`  - myPeerId: ${myPeerId}`);
    console.log(`  - connectionState: ${connectionState}`);
    console.log(`  - raw networkPeers:`, networkPeers);

    if (!session) {
      console.log("❌ No session available");
      return [];
    }

    if (networkPeers.length === 0) {
      console.log("📡 No network peers available yet");
      return [];
    }

    // Step 1: Deduplicate by peer ID (server should handle this, but safety net)
    const uniqueNetworkPeers = networkPeers.filter(
      (peer, index, self) => index === self.findIndex((p) => p.id === peer.id),
    );

    if (uniqueNetworkPeers.length !== networkPeers.length) {
      console.warn(
        `⚠️ Found duplicate peers! Filtered ${networkPeers.length} -> ${uniqueNetworkPeers.length}`,
      );
    }

    // Step 2: Filter out self (if myPeerId is set)
    const otherPeers = myPeerId
      ? uniqueNetworkPeers.filter((peer) => {
          const isSelf = peer.id === myPeerId;
          if (isSelf) {
            console.log(`🚫 Filtering out self: ${peer.name} (${peer.id})`);
          }
          return !isSelf;
        })
      : uniqueNetworkPeers; // If myPeerId not set yet, show all peers

    // Step 3: Convert to Peer interface
    const peerList = otherPeers.map((peerInfo) => ({
      id: peerInfo.id,
      name: peerInfo.name,
      deviceType: peerInfo.deviceType as Peer["deviceType"],
      isOnline: peerInfo.isOnline,
      lastSeen: Date.now(), // Mark as recently seen
    }));

    console.log(
      `✅ Discovered ${peerList.length} peers:`,
      peerList.map((p) => `${p.name} (${p.id.slice(0, 8)}...)`),
    );

    return peerList;
  }, [session, networkPeers, myPeerId, connectionState]);

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
