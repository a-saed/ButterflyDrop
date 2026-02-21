import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useServerWarmup } from "@/hooks/useServerWarmup";
import { ServerWarmupOverlay } from "@/components/connection/ServerWarmupOverlay";
import { SessionProvider } from "@/contexts/SessionContext";
import { ConnectionProvider } from "@/contexts/ConnectionContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useSession } from "@/hooks/useSession";
import { usePeerDiscovery } from "@/hooks/usePeerDiscovery";
import { WebRTCProvider, useWebRTCContext } from "@/contexts/WebRTCContext";
import { useFileTransfer } from "@/hooks/useFileTransfer";
import { useConnection } from "@/contexts/ConnectionContext";
import { AmbientBackground } from "@/components/layout/AmbientBackground";
import { ButterflyLogo } from "@/components/layout/ButterflyLogo";
import { PeerNetwork } from "@/components/peer/PeerNetwork";
import { FileList } from "@/components/transfer/FileList";
import { SendProgressPanel } from "@/components/transfer/SendProgressPanel";
import { ReceivedFilesPanel } from "@/components/transfer/ReceivedFilesPanel";
import { ShareLink } from "@/components/connection/ShareLink";
import { QRScanner } from "@/components/connection/QRScanner";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ConnectionStatus } from "@/components/connection/ConnectionStatus";
import { createShareableUrl } from "@/lib/sessionUtils";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  Upload,
  Send,
  Github,
  RefreshCw,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDropzone } from "react-dropzone";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { SyncSheet } from "@/components/sync/SyncSheet";
// BDP — Butterfly Delta Protocol
import { useBDP } from "@/bdp/hooks/useBDP";
import { SyncDashboard } from "@/bdp/components/SyncDashboard";
import {
  AddPairDialog,
  decodeQRPayload,
  extractBDPParam,
} from "@/bdp/components/AddPairDialog";
import { VaultBrowser } from "@/bdp/components/VaultBrowser";
import { ConflictResolver } from "@/bdp/components/ConflictResolver";
import { SyncProgress } from "@/bdp/components/SyncProgress";
import type { PairId } from "@/types/bdp";

import type { QRPayload } from "@/bdp/components/AddPairDialog";
import { cn } from "@/lib/utils";

function AppContent() {
  const {
    status: warmupStatus,
    elapsed: warmupElapsed,
    showOverlay: showWarmupOverlay,
  } = useServerWarmup();
  const session = useSession();
  const { joinSession } = session;
  const { peers, isScanning } = usePeerDiscovery();
  const { connectionState } = useConnection();
  const {
    getDataChannelForPeer,
    getQueuedMessagesForPeer,
    isPeerReady,
    readyPeers,
  } = useWebRTCContext();
  const {
    playConnect,
    playTransferStart,
    playSuccess,
    playFileReceived,
    playError,
  } = useSoundEffects();

  // File transfer with new API
  const {
    // Sending state
    isSending,
    sendingToPeer,
    sendProgress,
    sendComplete,
    sendError,
    sendCompletePeerName,
    // Receiving state
    isReceiving,
    receiveProgress,
    receiveComplete,
    receiveError,
    receiveCompletePeerName,
    // Incoming transfer
    incomingTransfer,
    // Received files
    receivedFiles,
    // Actions
    sendFiles,
    setupReceiver,
    downloadFile,
    downloadAllFiles,
    clearReceivedFiles,
    resetSendState,
    cleanupPeer,
    registerBDPHandler,
    formatBytes,
  } = useFileTransfer();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string>();
  const [syncPeerId, setSyncPeerId] = useState<string | null>(null);

  // ── BDP Sync ────────────────────────────────────────────────────────────────
  const bdp = useBDP({ getDataChannelForPeer, readyPeers });

  // Lazy-init: read ?bdp= once on first render — avoids setState-in-effect
  const [autoJoinPayload, setAutoJoinPayload] = useState<QRPayload | null>(
    () => {
      const bdpParam = new URLSearchParams(window.location.search).get("bdp");
      if (!bdpParam) return null;
      try {
        return decodeQRPayload(extractBDPParam(bdpParam));
      } catch {
        return null;
      }
    },
  );
  const [bdpPanelOpen, setBdpPanelOpen] = useState(() => {
    return !!new URLSearchParams(window.location.search).get("bdp");
  });
  const [addPairOpen, setAddPairOpen] = useState(() => {
    return !!new URLSearchParams(window.location.search).get("bdp");
  });
  /** null = show dashboard, PairId = show vault for that pair */
  const [vaultPairId, setVaultPairId] = useState<PairId | null>(null);
  /**
   * Which pair's conflict resolver to show (null = none).
   * Derived from engineStates so it always reflects the live session phase;
   * the user can manually dismiss it by clicking "Defer".
   */
  const [dismissedConflictPairs, setDismissedConflictPairs] = useState<
    Set<PairId>
  >(new Set());

  // Register BDP frame handler into useFileTransfer so BDP messages are
  // intercepted before the legacy protocol parser runs.
  useEffect(() => {
    return registerBDPHandler(bdp.handleFrame);
  }, [registerBDPHandler, bdp.handleFrame]);

  // ── Strip ?bdp= from the URL after reading it on mount ───────────────────
  useEffect(() => {
    if (!autoJoinPayload) return;
    const cleanUrl =
      window.location.pathname +
      window.location.search.replace(/[?&]bdp=[^&]*/g, "").replace(/^&/, "?") +
      window.location.hash;
    window.history.replaceState(null, "", cleanUrl || window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Derive the pairId whose conflict resolver should be shown.
   * Picks the first pair that is in resolving_conflict phase and has not been
   * dismissed by the user.  Pure derivation — no setState, no refs.
   */
  const activeConflictPairId = useMemo<PairId | null>(() => {
    for (const [pairId, state] of bdp.engineStates.entries()) {
      if (
        state.phase === "resolving_conflict" &&
        state.pendingConflicts.length > 0 &&
        !dismissedConflictPairs.has(pairId)
      ) {
        return pairId;
      }
    }
    return null;
  }, [bdp.engineStates, dismissedConflictPairs]);

  // Track which peers have receivers set up
  const setupPeersRef = useRef<Set<string>>(new Set());
  // Track which peers we've already shown a "connected" toast for
  // (separate from setupPeersRef so reconnects can re-toast correctly)
  const toastedPeersRef = useRef<Set<string>>(new Set());
  // Track readyPeers from the previous render to detect departures
  const previousReadyPeersRef = useRef<string[]>([]);
  // Track if we've already shown connection failed toast
  const connectionFailedToastShownRef = useRef(false);
  const previousConnectionStateRef = useRef<string | null>(null);
  // Track which sessions we've already joined (to prevent duplicate toasts)
  const joinedSessionsRef = useRef<Set<string>>(new Set());
  // Dedup refs for error toasts — only re-toast when the message actually changes
  const previousSendErrorRef = useRef<string | null>(null);
  const previousReceiveErrorRef = useRef<string | null>(null);

  const shareableUrl = session.session
    ? createShareableUrl(session.session.id)
    : "";

  // Handle QR code scan success
  const handleQRScanSuccess = useCallback(
    (sessionId: string) => {
      // Prevent duplicate joins - check if already in this session
      if (session.session?.id === sessionId) {
        console.log(`⚠️ Already in session ${sessionId}, skipping`);
        return;
      }

      // Prevent duplicate joins from QR scanner
      if (joinedSessionsRef.current.has(sessionId)) {
        console.log(`⚠️ Already joined session ${sessionId}, skipping`);
        return;
      }

      console.log(`📱 QR Code scanned, joining session: ${sessionId}`);

      // Mark as joined before calling joinSession
      joinedSessionsRef.current.add(sessionId);

      // Join the session
      joinSession(sessionId);

      // Update URL to reflect the new session
      const newHash = `#session=${sessionId}`;
      window.history.replaceState(null, "", newHash);

      toast.success("Session joined!", {
        description: "Connecting to peers...",
        icon: "🦋",
      });
    },
    [joinSession, session.session],
  );

  // Setup file receiver for all ready peers
  // This is CRITICAL - must set up onmessage handler before files arrive
  useEffect(() => {
    // ── Cleanup stale entries ────────────────────────────────────────────────
    // When a peer disconnects and later reconnects, readyPeers first removes
    // the peerId, then adds it again. Without this cleanup, setupPeersRef
    // still holds the old peerId so setupReceiver is never called for the new
    // data channel, and messages arrive silently with no handler.
    const currentReadySet = new Set(readyPeers);
    setupPeersRef.current.forEach((id) => {
      if (!currentReadySet.has(id)) {
        setupPeersRef.current.delete(id);
        // Also clear the internal setupChannelsRef inside useFileTransfer so
        // setupReceiver is allowed to run again for the new channel.
        cleanupPeer(id);
      }
    });

    if (session.session && readyPeers.length > 0) {
      readyPeers.forEach((peerId) => {
        // Skip if already set up for this connection
        if (setupPeersRef.current.has(peerId)) return;

        const dataChannel = getDataChannelForPeer(peerId);
        if (dataChannel && dataChannel.readyState === "open") {
          const peer = peers.find((p) => p.id === peerId);
          const peerName = peer?.name || "Unknown Device";

          // Get any messages that were queued before we set up the handler
          const queuedMessages = getQueuedMessagesForPeer(peerId);

          console.log(`🔧 Setting up receiver for ${peerName} (${peerId})`);
          setupReceiver(peerId, peerName, dataChannel, queuedMessages);
          setupPeersRef.current.add(peerId);
        }
      });
    }
  }, [
    session.session,
    readyPeers,
    peers,
    getDataChannelForPeer,
    getQueuedMessagesForPeer,
    setupReceiver,
    cleanupPeer,
  ]);

  // Track previous ready peers count for sound effects
  const previousReadyPeersCountRef = useRef(0);
  // Gate send / receive one-shot toasts
  const previousSendCompleteRef = useRef(false);
  const previousReceiveCompleteRef = useRef(false);

  // ─── Connection status toasts ────────────────────────────────────────────
  useEffect(() => {
    const previousState = previousConnectionStateRef.current;
    previousConnectionStateRef.current = connectionState;

    // Detect peers that LEFT readyPeers so we can allow re-toasting on reconnect
    const currentSet = new Set(readyPeers);
    previousReadyPeersRef.current.forEach((id) => {
      if (!currentSet.has(id)) {
        toastedPeersRef.current.delete(id);
      }
    });
    previousReadyPeersRef.current = [...readyPeers];

    if (readyPeers.length > 0) {
      // Only toast peers we haven't toasted yet in this session
      const newPeers = readyPeers.filter(
        (id) => !toastedPeersRef.current.has(id),
      );

      if (newPeers.length > 0) {
        const peerNames = peers
          .filter((p) => newPeers.includes(p.id))
          .map((p) => p.name)
          .join(", ");

        // Mark as toasted BEFORE firing so re-renders can't double-fire
        newPeers.forEach((id) => toastedPeersRef.current.add(id));

        if (peerNames) {
          toast.success(`Connected with ${peerNames}`, {
            // Stable ID prevents stacking duplicate toasts
            id: `peer-connected-${newPeers.sort().join("-")}`,
            icon: "🦋",
            duration: 3000,
          });
          if (readyPeers.length > previousReadyPeersCountRef.current) {
            playConnect();
          }
        }
      }

      previousReadyPeersCountRef.current = readyPeers.length;
      connectionFailedToastShownRef.current = false;
    } else if (connectionState === "failed" && previousState !== "failed") {
      if (!connectionFailedToastShownRef.current) {
        connectionFailedToastShownRef.current = true;
        toastedPeersRef.current.clear();
        toast.error("Connection failed", {
          id: "connection-failed",
          description: "Check your network and try refreshing",
          duration: 5000,
        });
        playError();
      }
    } else if (connectionState !== "failed") {
      connectionFailedToastShownRef.current = false;
    }
  }, [connectionState, readyPeers, peers, playConnect, playError]);

  // ─── Send error toast ────────────────────────────────────────────────────
  // Only re-fires when the error *message* changes, not on every re-render
  useEffect(() => {
    if (sendError && sendError !== previousSendErrorRef.current) {
      previousSendErrorRef.current = sendError;
      toast.error("Send failed", {
        id: "send-error",
        description: sendError,
        duration: 5000,
      });
      playError();
    } else if (!sendError) {
      previousSendErrorRef.current = null;
      toast.dismiss("send-error");
    }
  }, [sendError, playError]);

  // ─── Receive error toast ─────────────────────────────────────────────────
  useEffect(() => {
    if (receiveError && receiveError !== previousReceiveErrorRef.current) {
      previousReceiveErrorRef.current = receiveError;
      toast.error("Receive failed", {
        id: "receive-error",
        description: receiveError,
        duration: 5000,
      });
      playError();
    } else if (!receiveError) {
      previousReceiveErrorRef.current = null;
      toast.dismiss("receive-error");
    }
  }, [receiveError, playError]);

  // ─── Send complete toast ─────────────────────────────────────────────────
  // Fires exactly once per transfer; resets when sendComplete goes false
  useEffect(() => {
    if (sendComplete && !previousSendCompleteRef.current) {
      previousSendCompleteRef.current = true;
      playSuccess();
      const peerName = sendCompletePeerName || "peer";
      toast.success(`Files sent to ${peerName}!`, {
        id: "send-complete",
        icon: "🦋",
        duration: 4000,
      });
    } else if (!sendComplete) {
      previousSendCompleteRef.current = false;
    }
  }, [sendComplete, sendCompletePeerName, playSuccess]);

  // ─── Receive complete toast ──────────────────────────────────────────────
  // THE FIX: gate the toast AND the sound behind the ref so that any
  // subsequent re-renders while receiveComplete is still true (common on
  // mobile due to peer-list churn) cannot fire another toast.
  useEffect(() => {
    if (
      receiveComplete &&
      receivedFiles.length > 0 &&
      !previousReceiveCompleteRef.current
    ) {
      // Set guard FIRST — before any async work
      previousReceiveCompleteRef.current = true;

      const fileCount = receivedFiles.length;
      const peerName = receiveCompletePeerName || "peer";

      toast.success(
        `${fileCount} file${fileCount > 1 ? "s" : ""} received from ${peerName}!`,
        {
          id: "receive-complete",
          icon: "✅",
          description: "Tap below to download",
          duration: 6000,
        },
      );
      playFileReceived();
    } else if (!receiveComplete) {
      previousReceiveCompleteRef.current = false;
      toast.dismiss("receive-complete");
    }
  }, [
    receiveComplete,
    receivedFiles.length,
    receiveCompletePeerName,
    playFileReceived,
  ]);

  // File drop handling
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...acceptedFiles]);
      toast.success(
        `${acceptedFiles.length} file${acceptedFiles.length > 1 ? "s" : ""} added`,
        { icon: "📁" },
      );
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleClearFiles = useCallback(() => {
    setSelectedFiles([]);
  }, []);

  const handleSend = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    if (!selectedPeerId) {
      toast.error("No peer selected", {
        description: "Click on a device to select it",
      });
      return;
    }

    const peer = peers.find((p) => p.id === selectedPeerId);
    const peerName = peer?.name || "peer";

    // Check if peer connection is ready
    if (!isPeerReady(selectedPeerId)) {
      toast.info(`Connecting to ${peerName}...`, {
        description: "Wait for the connection to be established",
        icon: "⏳",
        duration: 3000,
      });
      return;
    }

    // Get data channel for this peer
    const dataChannel = getDataChannelForPeer(selectedPeerId);
    if (!dataChannel || dataChannel.readyState !== "open") {
      toast.error(`Cannot connect to ${peerName}`, {
        description: "Connection lost. Try refreshing the page.",
        icon: "❌",
      });
      return;
    }

    try {
      // Play transfer start sound
      playTransferStart();
      await sendFiles(selectedFiles, dataChannel, selectedPeerId, peerName);

      // Clear files after successful transfer
      setTimeout(() => {
        setSelectedFiles([]);
      }, 2000);
    } catch (error) {
      console.error("Failed to send files:", error);
      // Error is already shown via sendError state
    }
  }, [
    selectedFiles,
    selectedPeerId,
    peers,
    isPeerReady,
    getDataChannelForPeer,
    sendFiles,
    playTransferStart,
  ]);

  const handlePeerSelect = useCallback(
    (peerId: string) => {
      setSelectedPeerId(peerId);
      const peer = peers.find((p) => p.id === peerId);
      if (peer && selectedFiles.length > 0) {
        toast.info(`Ready to send to ${peer.name}`, {
          icon: "📱",
          duration: 2000,
        });
      }
    },
    [selectedFiles, peers],
  );

  const handleSyncWithPeer = useCallback((peerId: string) => {
    setSyncPeerId(peerId);
  }, []);

  // Auto-select first peer when peers are discovered
  useEffect(() => {
    if (peers.length > 0 && !selectedPeerId) {
      const timer = setTimeout(() => {
        setSelectedPeerId(peers[0].id);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [peers, selectedPeerId]);

  // Can send if have files and peer selected and not already transferring
  const canSend =
    selectedFiles.length > 0 &&
    !isSending &&
    selectedPeerId &&
    isPeerReady(selectedPeerId);

  // Get selected peer name
  const selectedPeerName = selectedPeerId
    ? peers.find((p) => p.id === selectedPeerId)?.name || "peer"
    : "";

  // ── BDP panel helpers ─────────────────────────────────────────────────────
  const bdpConflictState = activeConflictPairId
    ? bdp.engineStates.get(activeConflictPairId)
    : undefined;
  const bdpVaultPair = vaultPairId
    ? (bdp.pairs.find((p) => p.pairId === vaultPairId) ?? null)
    : null;

  return (
    <div className="min-h-screen relative" {...getRootProps()}>
      <input {...getInputProps()} />

      {/* Server Warm-up Overlay — shown only during cold-start, never for warm servers */}
      {showWarmupOverlay && (
        <ServerWarmupOverlay status={warmupStatus} elapsed={warmupElapsed} />
      )}

      {/* Ambient Background */}
      <AmbientBackground />

      {/* Drag Overlay */}
      {isDragActive && (
        <div
          className="fixed inset-0 bg-primary/10 backdrop-blur-sm flex items-center justify-center"
          style={{ zIndex: 50 }}
        >
          <div className="text-center">
            <Upload className="h-24 w-24 text-primary mx-auto mb-4 animate-bounce" />
            <p className="text-2xl font-semibold text-primary">
              Drop files here
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div
        className="relative min-h-screen flex flex-col"
        style={{ zIndex: 10 }}
      >
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 p-4 sm:p-6 border-b border-border/50 backdrop-blur-sm bg-background/50">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <ButterflyLogo />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold truncate">
                Butterfly Drop
              </h1>
              <p className="text-sm sm:text-base md:text-lg font-medium text-muted-foreground">
                Let your files fly
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 w-full sm:w-auto justify-end flex-wrap">
            {shareableUrl && (
              <div className="flex-1 sm:flex-initial min-w-0">
                <ShareLink url={shareableUrl} />
              </div>
            )}
            <QRScanner onScanSuccess={handleQRScanSuccess} />
            <ConnectionStatus
              peerCount={readyPeers.length}
              sessionId={session.session?.id || null}
            />
            {/* BDP Sync panel toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setBdpPanelOpen((v) => !v)}
              className={cn(
                "h-9 w-9 relative",
                bdpPanelOpen && "bg-primary/10 text-primary",
              )}
              aria-label="Sync pairs"
              title="Butterfly Delta Protocol — folder sync"
            >
              <RefreshCw className="h-5 w-5" />
              {/* Badge for active syncs or conflicts */}
              {(() => {
                const conflicts = [...bdp.engineStates.values()].filter(
                  (s) => s.phase === "resolving_conflict",
                ).length;
                const syncing = [...bdp.engineStates.values()].filter(
                  (s) =>
                    s.phase === "transferring" ||
                    s.phase === "diffing" ||
                    s.phase === "delta_sync" ||
                    s.phase === "full_sync",
                ).length;
                if (conflicts > 0)
                  return (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] text-white font-bold">
                      {conflicts}
                    </span>
                  );
                if (syncing > 0)
                  return (
                    <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
                    </span>
                  );
                return null;
              })()}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                window.open("https://github.com/a-saed/ButterflyDrop", "_blank")
              }
              className="h-9 w-9"
              aria-label="View on GitHub"
            >
              <Github className="h-5 w-5" />
            </Button>
            <ThemeToggle />
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 relative">
          {/* Peer Network - Full screen spatial layout */}
          <div className="absolute inset-0">
            <PeerNetwork
              peers={peers}
              selectedPeerId={selectedPeerId}
              onPeerSelect={handlePeerSelect}
              hasFiles={selectedFiles.length > 0}
              readyPeers={readyPeers}
              onSyncWithPeer={handleSyncWithPeer}
            />
          </div>

          {/* Bottom Panel - File Selection & Send Progress */}
          <div className="absolute bottom-0 left-0 right-0 px-6 pb-6">
            <div className="max-w-4xl mx-auto space-y-4">
              {/* Connection Status */}
              {isScanning && peers.length === 0 && (
                <div className="text-center text-sm text-muted-foreground mb-2">
                  Waiting for devices to connect...
                </div>
              )}

              {/* Send Progress Panel */}
              <SendProgressPanel
                isSending={isSending}
                sendProgress={sendProgress}
                sendComplete={sendComplete}
                sendError={sendError}
                peerName={
                  sendingToPeer
                    ? peers.find((p) => p.id === sendingToPeer)?.name || "peer"
                    : selectedPeerName
                }
                onReset={resetSendState}
              />

              {/* File Selection Area - Only show when not sending */}
              {!isSending && !sendComplete && (
                <>
                  {selectedFiles.length > 0 ? (
                    <div className="bg-background/95 backdrop-blur-xl border border-border/50 rounded-2xl p-4 shadow-2xl">
                      <FileList
                        files={selectedFiles}
                        onRemove={handleRemoveFile}
                        onClear={handleClearFiles}
                      />

                      {/* Send Button */}
                      {canSend && (
                        <div className="flex justify-center mt-4">
                          <Button
                            size="lg"
                            onClick={handleSend}
                            className="gap-2 min-w-60 h-12 text-base shadow-lg hover:shadow-xl transition-all"
                          >
                            <Send className="h-5 w-5" />
                            Send {selectedFiles.length} file
                            {selectedFiles.length > 1 ? "s" : ""} to{" "}
                            {selectedPeerName}
                          </Button>
                        </div>
                      )}

                      {/* Waiting for peer */}
                      {selectedFiles.length > 0 &&
                        !canSend &&
                        peers.length === 0 && (
                          <div className="text-center mt-4 text-sm text-muted-foreground">
                            <p>
                              Share the link above to connect with another
                              device
                            </p>
                          </div>
                        )}

                      {/* Waiting for connection */}
                      {selectedFiles.length > 0 &&
                        !canSend &&
                        peers.length > 0 &&
                        selectedPeerId &&
                        !isPeerReady(selectedPeerId) && (
                          <div className="text-center mt-4 text-sm text-muted-foreground">
                            <p>
                              Establishing connection with {selectedPeerName}...
                            </p>
                          </div>
                        )}
                    </div>
                  ) : (
                    <div className="bg-background/80 backdrop-blur-sm border border-border/50 rounded-2xl p-6 text-center">
                      <Upload className="h-10 w-10 text-muted-foreground/50 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground mb-3">
                        {peers.length > 0
                          ? "Drop files anywhere or click to select"
                          : "Scan a QR code or share the link to connect, then drop files to send"}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          document.getElementById("file-input")?.click()
                        }
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Select Files
                      </Button>
                    </div>
                  )}
                </>
              )}

              <input
                id="file-input"
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    const files = Array.from(e.target.files);
                    setSelectedFiles((prev) => [...prev, ...files]);
                    toast.success(
                      `${files.length} file${files.length > 1 ? "s" : ""} added`,
                      { icon: "📁" },
                    );
                  }
                }}
              />
            </div>
          </div>
        </main>
      </div>

      {/* Received Files Panel - Floating on right side */}
      <ReceivedFilesPanel
        incomingTransfer={incomingTransfer}
        receiveProgress={receiveProgress}
        isReceiving={isReceiving}
        receivedFiles={receivedFiles}
        receiveComplete={receiveComplete}
        onDownloadFile={downloadFile}
        onDownloadAll={downloadAllFiles}
        onClear={clearReceivedFiles}
        formatBytes={formatBytes}
      />

      {/* Folder Sync Sheet — triggered from peer avatar "Sync folder" button */}
      {syncPeerId && (
        <SyncSheet
          open={!!syncPeerId}
          onClose={() => {
            setSyncPeerId(null);
            resetSendState();
          }}
          peerId={syncPeerId}
          peerName={peers.find((p) => p.id === syncPeerId)?.name ?? "Peer"}
          sendFiles={sendFiles}
          getDataChannelForPeer={getDataChannelForPeer}
          isPeerReady={isPeerReady}
          isSending={isSending}
          sendProgress={sendProgress}
          sendComplete={sendComplete}
          sendError={sendError}
          resetSendState={resetSendState}
          formatBytes={formatBytes}
        />
      )}

      {/* ── BDP Sync Panel ─────────────────────────────────────────────────── */}
      {/* Slide-in panel from the right, sits above everything else */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 w-full sm:w-105 z-40 flex flex-col",
          "bg-background/95 backdrop-blur-md border-l border-border/60 shadow-2xl",
          "transition-transform duration-300 ease-in-out",
          bdpPanelOpen ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!bdpPanelOpen}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-2">
            <RefreshCw className="size-4 text-primary" />
            <span className="text-sm font-semibold">Sync Pairs</span>
            {bdp.initialising && (
              <span className="text-xs text-muted-foreground">(loading…)</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setBdpPanelOpen(false);
              setVaultPairId(null);
            }}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Init error */}
        {bdp.initError && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10 px-3 py-2.5">
            <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-600 dark:text-red-400">
              {bdp.initError.message}
            </p>
          </div>
        )}

        {/* Panel body — scrollable */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {/* ── Active sync progress for any transferring pair ── */}
          {[...bdp.engineStates.entries()]
            .filter(([, s]) =>
              [
                "greeting",
                "diffing",
                "delta_sync",
                "full_sync",
                "transferring",
                "finalizing",
              ].includes(s.phase),
            )
            .map(([pairId, state]) => (
              <div key={pairId} className="mb-4">
                <SyncProgress state={state} />
              </div>
            ))}

          {/* ── Conflict resolver ── */}
          {activeConflictPairId &&
            bdpConflictState?.phase === "resolving_conflict" &&
            bdpConflictState.pendingConflicts.length > 0 && (
              <div className="mb-4">
                <ConflictResolver
                  pairId={activeConflictPairId}
                  conflicts={bdpConflictState.pendingConflicts}
                  localDeviceName={bdp.device?.deviceName ?? "This device"}
                  remoteDeviceName={
                    bdpConflictState.peerDeviceName ?? "Remote device"
                  }
                  onResolve={bdp.resolveConflict}
                  onAllResolved={() =>
                    setDismissedConflictPairs((prev) => {
                      const next = new Set(prev);
                      next.add(activeConflictPairId);
                      return next;
                    })
                  }
                  onDismiss={() =>
                    setDismissedConflictPairs((prev) => {
                      const next = new Set(prev);
                      next.add(activeConflictPairId);
                      return next;
                    })
                  }
                />
              </div>
            )}

          {/* ── Vault browser ── */}
          {vaultPairId && bdpVaultPair ? (
            <VaultBrowser
              pairId={vaultPairId}
              files={bdp.vaultFiles.get(vaultPairId) ?? []}
              folderName={bdpVaultPair.localFolder.name}
              onRefresh={() => bdp.refreshVaultFiles(vaultPairId)}
              onClose={() => setVaultPairId(null)}
            />
          ) : (
            /* ── Sync dashboard ── */
            <SyncDashboard
              pairs={bdp.pairs}
              engineStates={bdp.engineStates}
              onAddPair={() => setAddPairOpen(true)}
              onViewVault={(pairId) => {
                setVaultPairId(pairId);
              }}
              onDeletePair={async (pairId) => {
                await bdp.deletePair(pairId);
                toast.success("Sync pair removed");
              }}
              onSyncNow={(pairId) => {
                bdp.triggerSync(pairId).catch((err) => {
                  toast.error("Sync failed", {
                    description:
                      err instanceof Error ? err.message : String(err),
                  });
                });
              }}
            />
          )}
        </div>
      </div>

      {/* BDP panel backdrop (mobile) */}
      {bdpPanelOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 sm:hidden"
          onClick={() => setBdpPanelOpen(false)}
        />
      )}

      {/* Add Pair Dialog */}
      <AddPairDialog
        open={addPairOpen}
        onOpenChange={(next) => {
          setAddPairOpen(next);
          if (!next) setAutoJoinPayload(null);
        }}
        device={bdp.device}
        readyPeers={readyPeers}
        sessionId={session.session?.id ?? ""}
        joinSession={joinSession}
        autoJoinPayload={autoJoinPayload}
        onCreatePair={async (opts) => {
          const pair = await bdp.createPair(opts);
          toast.success(`Sync pair "${opts.folderName}" created`, {
            icon: "🔗",
          });
          return pair;
        }}
      />

      <Toaster />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <ConnectionProvider>
          {/* WebRTCProvider ensures useWebRTC() is instantiated exactly once.
              All hooks/components that need WebRTC state must use
              useWebRTCContext() instead of calling useWebRTC() directly. */}
          <WebRTCProvider>
            <AppContent />
          </WebRTCProvider>
        </ConnectionProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

export default App;
