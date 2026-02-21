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
  AlertTriangle,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDropzone } from "react-dropzone";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { BDPProtocolInfo } from "@/bdp/components/BDPProtocolInfo";

// BDP
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

type AppTab = "send" | "sync";

// ─────────────────────────────────────────────────────────────────────────────
// AppContent
// ─────────────────────────────────────────────────────────────────────────────

function AppContent() {
  const {
    status: warmupStatus,
    elapsed: warmupElapsed,
    showOverlay: showWarmupOverlay,
  } = useServerWarmup();
  const session = useSession();
  const { joinSession } = session;
  const { peers } = usePeerDiscovery();
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

  const {
    isSending,
    sendingToPeer,
    sendProgress,
    sendComplete,
    sendError,
    sendCompletePeerName,
    isReceiving,
    receiveProgress,
    receiveComplete,
    receiveError,
    receiveCompletePeerName,
    incomingTransfer,
    receivedFiles,
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

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<AppTab>(() =>
    new URLSearchParams(window.location.search).get("bdp") ? "sync" : "send",
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string | undefined>();

  // ── BDP state ─────────────────────────────────────────────────────────────
  const bdp = useBDP({ getDataChannelForPeer, readyPeers });

  const [autoJoinPayload] = useState<QRPayload | null>(() => {
    const param = new URLSearchParams(window.location.search).get("bdp");
    if (!param) return null;
    try {
      return decodeQRPayload(extractBDPParam(param));
    } catch {
      return null;
    }
  });
  const [addPairOpen, setAddPairOpen] = useState(
    () => !!new URLSearchParams(window.location.search).get("bdp"),
  );
  const [vaultPairId, setVaultPairId] = useState<PairId | null>(null);
  const [dismissedConflictPairs, setDismissedConflictPairs] = useState<
    Set<PairId>
  >(new Set());

  // Strip ?bdp= from URL on mount
  useEffect(() => {
    if (!autoJoinPayload) return;
    const clean =
      window.location.pathname +
      window.location.search.replace(/[?&]bdp=[^&]*/g, "").replace(/^&/, "?") +
      window.location.hash;
    window.history.replaceState(null, "", clean || window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Register BDP frame handler
  useEffect(
    () => registerBDPHandler(bdp.handleFrame),
    [registerBDPHandler, bdp.handleFrame],
  );

  const activeConflictPairId = useMemo<PairId | null>(() => {
    for (const [pairId, state] of bdp.engineStates.entries()) {
      if (
        state.phase === "resolving_conflict" &&
        state.pendingConflicts.length > 0 &&
        !dismissedConflictPairs.has(pairId)
      )
        return pairId;
    }
    return null;
  }, [bdp.engineStates, dismissedConflictPairs]);

  // ── Tracking refs ─────────────────────────────────────────────────────────
  const setupPeersRef = useRef<Set<string>>(new Set());
  const toastedPeersRef = useRef<Set<string>>(new Set());
  const prevConnectionStateRef = useRef<string | null>(null);
  const connectionFailedToastRef = useRef(false);
  const joinedSessionsRef = useRef<Set<string>>(new Set());
  const prevSendErrorRef = useRef<string | null>(null);
  const prevReceiveErrorRef = useRef<string | null>(null);
  const prevSendCompleteRef = useRef(false);
  const prevReceiveCompleteRef = useRef(false);

  const shareableUrl = session.session
    ? createShareableUrl(session.session.id)
    : "";

  // ── QR scan ───────────────────────────────────────────────────────────────
  const handleQRScanSuccess = useCallback(
    (sessionId: string) => {
      if (joinedSessionsRef.current.has(sessionId)) return;
      joinedSessionsRef.current.add(sessionId);
      joinSession(sessionId);
      const hash = `#${sessionId}`;
      if (window.location.hash !== hash)
        window.history.pushState(null, "", hash);
      toast.success("Session joined!", {
        icon: "🦋",
        description: "Connecting…",
        duration: 3000,
      });
    },
    [joinSession],
  );

  // ── CRITICAL: Set up receivers for all ready peers ─────────────────────────
  // We iterate ALL readyPeers (not just new ones) so that if the data channel
  // wasn't "open" on the first render, we catch it on the next one.
  useEffect(() => {
    // Clean up peers that left
    const currentSet = new Set(readyPeers);
    setupPeersRef.current.forEach((id) => {
      if (!currentSet.has(id)) {
        setupPeersRef.current.delete(id);
        cleanupPeer(id);
      }
    });

    // Set up receivers for every ready peer whose channel is open
    if (session.session && readyPeers.length > 0) {
      readyPeers.forEach((peerId) => {
        if (setupPeersRef.current.has(peerId)) return;
        const dataChannel = getDataChannelForPeer(peerId);
        if (dataChannel && dataChannel.readyState === "open") {
          const peer = peers.find((p) => p.id === peerId);
          const peerName = peer?.name ?? "Unknown Device";
          const queued = getQueuedMessagesForPeer(peerId);
          setupReceiver(peerId, peerName, dataChannel, queued);
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

  // ── Connection status toasts ──────────────────────────────────────────────
  useEffect(() => {
    const prev = prevConnectionStateRef.current;
    prevConnectionStateRef.current = connectionState;

    if (
      connectionState === "failed" &&
      prev !== "failed" &&
      !connectionFailedToastRef.current
    ) {
      connectionFailedToastRef.current = true;
      playError();
      toast.error("Connection failed", {
        description: "Check your network and try refreshing.",
        duration: 5000,
      });
    }
    if (connectionState !== "failed") connectionFailedToastRef.current = false;
  }, [connectionState, playError]);

  // ── Peer connect / disconnect toasts ─────────────────────────────────────
  useEffect(() => {
    readyPeers.forEach((id) => {
      if (!toastedPeersRef.current.has(id)) {
        toastedPeersRef.current.add(id);
        const peer = peers.find((p) => p.id === id);
        playConnect();
        toast.success(`${peer?.name ?? "Device"} connected`, {
          icon: "🦋",
          duration: 3000,
        });
      }
    });

    // Clean stale toast refs
    const currentSet = new Set(readyPeers);
    toastedPeersRef.current.forEach((id) => {
      if (!currentSet.has(id)) toastedPeersRef.current.delete(id);
    });
  }, [readyPeers, peers, playConnect]);

  // ── Send complete toast ───────────────────────────────────────────────────
  useEffect(() => {
    if (sendComplete && !prevSendCompleteRef.current) {
      prevSendCompleteRef.current = true;
      playSuccess();
      toast.success("Files sent!", {
        icon: "🎉",
        description: `To ${sendCompletePeerName ?? "peer"}`,
        duration: 4000,
      });
    }
    if (!sendComplete) prevSendCompleteRef.current = false;
  }, [sendComplete, sendCompletePeerName, playSuccess]);

  // ── Receive complete toast ────────────────────────────────────────────────
  useEffect(() => {
    if (
      receiveComplete &&
      receivedFiles.length > 0 &&
      !prevReceiveCompleteRef.current
    ) {
      prevReceiveCompleteRef.current = true;
      playFileReceived();
      toast.success(
        `${receivedFiles.length} file${receivedFiles.length > 1 ? "s" : ""} received!`,
        {
          icon: "📥",
          description: `From ${receiveCompletePeerName ?? "peer"}`,
          duration: 5000,
        },
      );
    }
    if (!receiveComplete) prevReceiveCompleteRef.current = false;
  }, [
    receiveComplete,
    receivedFiles.length,
    receiveCompletePeerName,
    playFileReceived,
  ]);

  // ── Send error toast ──────────────────────────────────────────────────────
  useEffect(() => {
    if (sendError && sendError !== prevSendErrorRef.current) {
      prevSendErrorRef.current = sendError;
      playError();
      toast.error("Send failed", { description: sendError, duration: 5000 });
    }
    if (!sendError) prevSendErrorRef.current = null;
  }, [sendError, playError]);

  // ── Receive error toast ───────────────────────────────────────────────────
  useEffect(() => {
    if (receiveError && receiveError !== prevReceiveErrorRef.current) {
      prevReceiveErrorRef.current = receiveError;
      playError();
      toast.error("Receive failed", {
        description: receiveError,
        duration: 5000,
      });
    }
    if (!receiveError) prevReceiveErrorRef.current = null;
  }, [receiveError, playError]);

  // ── File drop ─────────────────────────────────────────────────────────────
  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) {
      setSelectedFiles((prev) => [...prev, ...accepted]);
      toast.success(
        `${accepted.length} file${accepted.length > 1 ? "s" : ""} added`,
        { icon: "📁" },
      );
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  // ── File actions ──────────────────────────────────────────────────────────
  const handleRemoveFile = useCallback(
    (i: number) => setSelectedFiles((p) => p.filter((_, idx) => idx !== i)),
    [],
  );
  const handleClearFiles = useCallback(() => setSelectedFiles([]), []);

  const handleSend = useCallback(async () => {
    if (!selectedFiles.length || !selectedPeerId) return;
    const peer = peers.find((p) => p.id === selectedPeerId);
    const peerName = peer?.name ?? "peer";

    if (!isPeerReady(selectedPeerId)) {
      toast.info(`Connecting to ${peerName}…`, { icon: "⏳", duration: 3000 });
      return;
    }
    const dc = getDataChannelForPeer(selectedPeerId);
    if (!dc || dc.readyState !== "open") {
      toast.error("Connection lost", {
        description: "Refresh and try again.",
        icon: "❌",
      });
      return;
    }
    try {
      playTransferStart();
      await sendFiles(selectedFiles, dc, selectedPeerId, peerName);
      setTimeout(() => setSelectedFiles([]), 2000);
    } catch (e) {
      console.error("Send error:", e);
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

  // Auto-select first peer
  useEffect(() => {
    if (peers.length > 0 && !selectedPeerId) {
      const t = setTimeout(() => setSelectedPeerId(peers[0]?.id), 100);
      return () => clearTimeout(t);
    }
  }, [peers, selectedPeerId]);

  const canSend =
    selectedFiles.length > 0 &&
    !isSending &&
    !!selectedPeerId &&
    isPeerReady(selectedPeerId ?? "");

  const selectedPeerName = selectedPeerId
    ? (peers.find((p) => p.id === selectedPeerId)?.name ?? "peer")
    : "";

  // ── BDP counts ────────────────────────────────────────────────────────────
  const bdpConflictCount = useMemo(
    () =>
      [...bdp.engineStates.values()].filter(
        (s) => s.phase === "resolving_conflict",
      ).length,
    [bdp.engineStates],
  );
  const bdpSyncingCount = useMemo(
    () =>
      [...bdp.engineStates.values()].filter((s) =>
        ["transferring", "diffing", "delta_sync", "full_sync"].includes(
          s.phase,
        ),
      ).length,
    [bdp.engineStates],
  );

  const bdpConflictState = activeConflictPairId
    ? bdp.engineStates.get(activeConflictPairId)
    : undefined;
  const bdpVaultPair = vaultPairId
    ? (bdp.pairs.find((p) => p.pairId === vaultPairId) ?? null)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-[100dvh] overflow-hidden relative" {...getRootProps()}>
      <input {...getInputProps()} />

      {showWarmupOverlay && (
        <ServerWarmupOverlay status={warmupStatus} elapsed={warmupElapsed} />
      )}

      <AmbientBackground />

      {/* Global drag overlay */}
      {isDragActive && activeTab === "send" && (
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

      <div className="relative h-full flex flex-col" style={{ zIndex: 10 }}>
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="shrink-0 bg-background/85 backdrop-blur-xl border-b border-border/30">
          <div className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5">
            {/* Logo */}
            <div className="flex items-center gap-2 shrink-0">
              <ButterflyLogo size={28} />
              <div className="flex flex-col leading-none">
                <span className="text-xs sm:text-sm font-bold tracking-tight text-foreground">
                  Butterfly Drop
                </span>
                <span className="text-[9px] sm:text-[10px] text-muted-foreground font-medium tracking-wide mt-0.5">
                  Let your files fly
                </span>
              </div>
            </div>

            {/* Tab toggle — centered */}
            <div className="flex-1 flex justify-center">
              <div className="relative flex items-center bg-muted/50 rounded-2xl p-1 gap-0.5">
                {/* Sliding highlight */}
                <div
                  className={cn(
                    "absolute top-1 bottom-1 rounded-xl transition-all duration-200 ease-out",
                    "bg-background shadow-sm border border-border/30",
                    activeTab === "send"
                      ? "left-1 right-[calc(50%+1px)]"
                      : "left-[calc(50%+1px)] right-1",
                  )}
                />
                <button
                  onClick={() => setActiveTab("send")}
                  className={cn(
                    "relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors duration-150 min-w-[60px] justify-center",
                    activeTab === "send"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/80",
                  )}
                >
                  <Send className="h-3 w-3" />
                  <span>Send</span>
                </button>
                <button
                  onClick={() => setActiveTab("sync")}
                  className={cn(
                    "relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors duration-150 min-w-[60px] justify-center",
                    activeTab === "sync"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/80",
                  )}
                >
                  <RefreshCw
                    className={cn(
                      "h-3 w-3",
                      bdpSyncingCount > 0 && "animate-spin",
                    )}
                  />
                  <span>Sync</span>
                  {bdpConflictCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 flex items-center justify-center rounded-full bg-orange-500 text-[8px] text-white font-bold">
                      {bdpConflictCount}
                    </span>
                  )}
                  {bdpConflictCount === 0 && bdpSyncingCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-0.5 shrink-0">
              {shareableUrl && <ShareLink url={shareableUrl} compact />}
              <QRScanner onScanSuccess={handleQRScanSuccess} />
              <ConnectionStatus
                peerCount={readyPeers.length}
                sessionId={session.session?.id ?? null}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  window.open(
                    "https://github.com/a-saed/ButterflyDrop",
                    "_blank",
                  )
                }
                className="h-8 w-8 hidden sm:flex"
                aria-label="GitHub"
              >
                <Github className="h-4 w-4" />
              </Button>
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* ── Tab: SEND FILES ─────────────────────────────────────────────── */}
        {activeTab === "send" && (
          <main className="flex-1 relative overflow-hidden min-h-0">
            {/* Peer Network — full-screen spatial layout */}
            <div className="absolute inset-0">
              <PeerNetwork
                peers={peers}
                selectedPeerId={selectedPeerId}
                onPeerSelect={handlePeerSelect}
                hasFiles={selectedFiles.length > 0}
                readyPeers={readyPeers}
                shareableUrl={shareableUrl}
              />
            </div>

            {/* Bottom Panel */}
            <div
              className="absolute bottom-0 left-0 right-0 px-3 sm:px-5"
              style={{
                paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))",
              }}
            >
              <div className="max-w-lg mx-auto space-y-2">
                {/* Transfer progress */}
                <SendProgressPanel
                  isSending={isSending}
                  sendProgress={sendProgress}
                  sendComplete={sendComplete}
                  sendError={sendError}
                  peerName={
                    sendingToPeer
                      ? (peers.find((p) => p.id === sendingToPeer)?.name ??
                        "peer")
                      : selectedPeerName
                  }
                  onReset={resetSendState}
                />

                {/* Idle state */}
                {!isSending && !sendComplete && (
                  <>
                    {selectedFiles.length > 0 ? (
                      /* ── Files staged ── */
                      <div className="bg-background/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl overflow-hidden">
                        <div className="px-3 pt-3 pb-2">
                          <FileList
                            files={selectedFiles}
                            onRemove={handleRemoveFile}
                            onClear={handleClearFiles}
                          />
                        </div>

                        <div className="px-3 pb-3 flex items-center gap-2">
                          {canSend ? (
                            <Button
                              size="lg"
                              onClick={handleSend}
                              className="flex-1 gap-2 h-11 text-sm font-semibold shadow-lg"
                            >
                              <Send className="h-4 w-4" />
                              Send to {selectedPeerName}
                            </Button>
                          ) : peers.length === 0 ? (
                            <p className="flex-1 text-center text-xs text-muted-foreground py-2">
                              Connect a device first to send
                            </p>
                          ) : selectedPeerId && !isPeerReady(selectedPeerId) ? (
                            <p className="flex-1 text-center text-xs text-muted-foreground py-2 animate-pulse">
                              Connecting to {selectedPeerName}…
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      /* ── Drop hint ── */
                      <button
                        onClick={() =>
                          document.getElementById("file-input")?.click()
                        }
                        className={cn(
                          "w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl",
                          "border-2 border-dashed transition-all duration-200 active:scale-[0.98]",
                          peers.length > 0
                            ? "border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/60"
                            : "border-border/40 bg-background/60 hover:bg-background/80",
                        )}
                      >
                        <Upload
                          className={cn(
                            "h-4 w-4 shrink-0",
                            peers.length > 0
                              ? "text-primary"
                              : "text-muted-foreground/60",
                          )}
                        />
                        <span
                          className={cn(
                            "text-sm font-medium",
                            peers.length > 0
                              ? "text-primary"
                              : "text-muted-foreground/70",
                          )}
                        >
                          {peers.length > 0
                            ? `Drop files to send to ${selectedPeerName}`
                            : "Drop files or tap to select"}
                        </span>
                      </button>
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

            {/* Received Files Panel — floating on right side */}
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
          </main>
        )}

        {/* ── Tab: SYNC PAIRS ─────────────────────────────────────────────── */}
        {activeTab === "sync" && (
          <main className="flex-1 overflow-y-auto min-h-0">
            <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
              {bdp.initError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10 px-3 py-2.5">
                  <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {bdp.initError.message}
                  </p>
                </div>
              )}

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
                  <SyncProgress key={pairId} state={state} />
                ))}

              {activeConflictPairId &&
                bdpConflictState?.phase === "resolving_conflict" &&
                bdpConflictState.pendingConflicts.length > 0 && (
                  <ConflictResolver
                    pairId={activeConflictPairId}
                    conflicts={bdpConflictState.pendingConflicts}
                    localDeviceName={bdp.device?.deviceName ?? "This device"}
                    remoteDeviceName={
                      bdpConflictState.peerDeviceName ?? "Remote device"
                    }
                    onResolve={bdp.resolveConflict}
                    onAllResolved={() =>
                      setDismissedConflictPairs((p) => {
                        const n = new Set(p);
                        n.add(activeConflictPairId);
                        return n;
                      })
                    }
                    onDismiss={() =>
                      setDismissedConflictPairs((p) => {
                        const n = new Set(p);
                        n.add(activeConflictPairId);
                        return n;
                      })
                    }
                  />
                )}

              {vaultPairId && bdpVaultPair ? (
                <VaultBrowser
                  pairId={vaultPairId}
                  files={bdp.vaultFiles.get(vaultPairId) ?? []}
                  folderName={bdpVaultPair.localFolder.name}
                  onRefresh={() => bdp.refreshVaultFiles(vaultPairId)}
                  onClose={() => setVaultPairId(null)}
                />
              ) : (
                <SyncDashboard
                  pairs={bdp.pairs}
                  engineStates={bdp.engineStates}
                  onAddPair={() => setAddPairOpen(true)}
                  onViewVault={(id) => setVaultPairId(id)}
                  onDeletePair={async (id) => {
                    await bdp.deletePair(id);
                    toast.success("Sync pair removed");
                  }}
                  onSyncNow={(id) => {
                    bdp.triggerSync(id).catch((e) =>
                      toast.error("Sync failed", {
                        description: e instanceof Error ? e.message : String(e),
                      }),
                    );
                  }}
                />
              )}

              {bdp.pairs.length > 0 && !vaultPairId && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddPairOpen(true)}
                    className="gap-2"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add another pair
                  </Button>
                </div>
              )}

              {/* BDP Protocol info — collapsible, always at the bottom */}
              <BDPProtocolInfo />
            </div>
          </main>
        )}
      </div>

      {/* Add Pair Dialog */}
      <AddPairDialog
        open={addPairOpen}
        onOpenChange={(v) => {
          setAddPairOpen(v);
          if (!v) {
            /* autoJoinPayload cleared already */
          }
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

// ─────────────────────────────────────────────────────────────────────────────
// App — provider tree
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <ConnectionProvider>
          <WebRTCProvider>
            <AppContent />
          </WebRTCProvider>
        </ConnectionProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

export default App;
