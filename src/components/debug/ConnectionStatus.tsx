import { useSession } from "@/contexts/SessionContext";
import { useConnection } from "@/contexts/ConnectionContext";
import { usePeerDiscovery } from "@/hooks/usePeerDiscovery";

export function ConnectionStatusDebug() {
  const { session, peers: sessionPeers, myPeerId } = useSession();
  const { connectionState } = useConnection();
  const { peers: discoveredPeers } = usePeerDiscovery();

  return (
    <div className="fixed bottom-4 right-4 bg-black/90 text-white p-4 rounded-lg text-xs font-mono max-w-sm z-50">
      <div className="font-bold mb-2">🔍 Connection Status</div>

      <div className="space-y-1">
        <div>
          <span className="text-gray-400">Session:</span>{" "}
          {session ? session.id.slice(0, 8) : "None"}
        </div>

        <div>
          <span className="text-gray-400">State:</span>{" "}
          <span className={connectionState === "connected" ? "text-green-400" : "text-yellow-400"}>
            {connectionState}
          </span>
        </div>

        <div>
          <span className="text-gray-400">My ID:</span>{" "}
          {myPeerId ? myPeerId.slice(0, 8) : "Not set"}
        </div>

        <div className="mt-2 pt-2 border-t border-gray-700">
          <div className="text-gray-400 mb-1">Session Peers: {sessionPeers.length}</div>
          {sessionPeers.map((peer) => (
            <div key={peer.id} className="ml-2 text-xs">
              • {peer.name} ({peer.id.slice(0, 8)})
              {peer.id === myPeerId && " [ME]"}
            </div>
          ))}
        </div>

        <div className="mt-2 pt-2 border-t border-gray-700">
          <div className="text-gray-400 mb-1">Discovered: {discoveredPeers.length}</div>
          {discoveredPeers.map((peer) => (
            <div key={peer.id} className="ml-2 text-xs text-green-400">
              • {peer.name} ({peer.id.slice(0, 8)})
            </div>
          ))}
        </div>

        {discoveredPeers.length === 0 && sessionPeers.length > 0 && (
          <div className="mt-2 text-yellow-400">
            ⚠️ Session has peers but none discovered!
          </div>
        )}
      </div>
    </div>
  );
}
