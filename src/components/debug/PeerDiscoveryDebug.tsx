import { useEffect, useState } from "react";
import { useSession } from "@/contexts/SessionContext";
import { useConnection } from "@/contexts/ConnectionContext";
import { usePeerDiscovery } from "@/hooks/usePeerDiscovery";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface LogEntry {
  timestamp: string;
  level: "info" | "error" | "warn";
  message: string;
}

export function PeerDiscoveryDebug() {
  const { session, peers: sessionPeers, myPeerId } = useSession();
  const { connectionState, error } = useConnection();
  const { peers: discoveredPeers, isScanning } = usePeerDiscovery();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = (level: LogEntry["level"], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-49), { timestamp, level, message }]);
  };

  const clearLogs = () => setLogs([]);

  // Log changes
  useEffect(() => {
    if (session) {
      addLog("info", `Session: ${session.id} (${session.role})`);
    }
  }, [session]);

  useEffect(() => {
    addLog("info", `Connection state: ${connectionState}`);
  }, [connectionState]);

  useEffect(() => {
    if (error) {
      addLog("error", `Error: ${error}`);
    }
  }, [error]);

  useEffect(() => {
    addLog("info", `Session peers count: ${sessionPeers.length}`);
    sessionPeers.forEach((peer) => {
      addLog("info", `Session peer: ${peer.name} (${peer.id})`);
    });
  }, [sessionPeers]);

  useEffect(() => {
    addLog("info", `Discovered peers count: ${discoveredPeers.length}`);
    discoveredPeers.forEach((peer) => {
      addLog("info", `Discovered peer: ${peer.name} (${peer.id})`);
    });
  }, [discoveredPeers]);

  useEffect(() => {
    if (myPeerId) {
      addLog("info", `My peer ID: ${myPeerId}`);
    }
  }, [myPeerId]);

  useEffect(() => {
    addLog("info", `Scanning: ${isScanning}`);
  }, [isScanning]);

  return (
    <div className="fixed bottom-4 right-4 w-96 z-50">
      <Card className="p-4 bg-background/95 backdrop-blur border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Peer Discovery Debug</h3>
          <Button variant="ghost" size="sm" onClick={clearLogs}>
            Clear
          </Button>
        </div>

        {/* Current State */}
        <div className="space-y-2 text-xs mb-4 p-2 bg-muted/50 rounded">
          <div>
            Session: {session ? `${session.id} (${session.role})` : "None"}
          </div>
          <div>Connection: {connectionState}</div>
          <div>My Peer ID: {myPeerId || "None"}</div>
          <div>Session Peers: {sessionPeers.length}</div>
          <div>Discovered Peers: {discoveredPeers.length}</div>
          <div>Scanning: {isScanning ? "Yes" : "No"}</div>
          {error && <div className="text-red-500">Error: {error}</div>}
        </div>

        {/* Logs */}
        <div className="h-64 overflow-y-auto space-y-1 text-xs font-mono">
          {logs.length === 0 ? (
            <div className="text-muted-foreground">No logs yet...</div>
          ) : (
            logs.map((log, i) => (
              <div
                key={i}
                className={`flex gap-2 ${
                  log.level === "error"
                    ? "text-red-500"
                    : log.level === "warn"
                      ? "text-yellow-500"
                      : "text-foreground"
                }`}
              >
                <span className="text-muted-foreground">{log.timestamp}</span>
                <span className="flex-1">{log.message}</span>
              </div>
            ))
          )}
        </div>

        {/* Peer List */}
        {(sessionPeers.length > 0 || discoveredPeers.length > 0) && (
          <div className="mt-4 pt-4 border-t space-y-2">
            <div className="text-xs font-semibold">Current Peers:</div>
            <div className="space-y-1">
              {sessionPeers.map((peer) => (
                <div key={peer.id} className="flex items-center gap-2 text-xs">
                  <Badge variant="secondary" className="text-xs">
                    Session
                  </Badge>
                  <span className="font-mono">{peer.name}</span>
                  <span className="text-muted-foreground">
                    ({peer.id.slice(0, 8)}...)
                  </span>
                </div>
              ))}
              {discoveredPeers.map((peer) => (
                <div key={peer.id} className="flex items-center gap-2 text-xs">
                  <Badge variant="default" className="text-xs">
                    Discovered
                  </Badge>
                  <span className="font-mono">{peer.name}</span>
                  <span className="text-muted-foreground">
                    ({peer.id.slice(0, 8)}...)
                  </span>
                  <Badge
                    variant={peer.isOnline ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {peer.isOnline ? "Online" : "Offline"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Test Actions */}
        <div className="mt-4 pt-4 border-t space-y-2">
          <div className="text-xs font-semibold">Test Actions:</div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(window.location.href, "_blank")}
            >
              Open New Tab
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const url = window.location.href;
                navigator.clipboard?.writeText(url);
                addLog("info", "URL copied to clipboard");
              }}
            >
              Copy URL
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                addLog("info", "Manual refresh triggered");
                window.location.reload();
              }}
            >
              Refresh
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
