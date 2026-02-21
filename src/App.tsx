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
  CheckCircle2,
  Loader2,
  FileUp,
  Link2,
  ChevronDown,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDropzone } from "react-dropzone";
import { useSoundEffects } from "@/hooks/useSoundEffects";

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

// ─────────────────────────────────────────────────────────────────────────────
// Tab type
// ─────────────────────────────────────────────────────────────────────────────

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

  // File transfer state
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

  // ── UI state ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<AppTab>(() =>
    new URLSearchParams(window.location.search).get("bdp") ? "sync" : "send",
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string>();

  // ── BDP Sync ────────────────────────────────────────────────────────────────
  const bdp = useBDP({ getDataChannelForPeer, readyPeers });

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

  // If app was opened via a ?bdp= link, jump straight to Sync tab
  const [addPairOpen, setAddPairOpen] = useState(() => {
    return !!new URLSearchParams(window.location.search).get("bdp");
  });

  const [vaultPairId, setVaultPairId] = useState<PairId | null>(null);
  const [dismissedConflictPairs, setDismissedConflictPairs] = useState<
    Set<PairId>
  >(new Set());

  // Register BDP frame handler
  useEffect(() => {
    return registerBDPHandler(bdp.handleFrame);
  }, [registerBDPHandler, bdp.handleFrame]);

  // Strip ?bdp= from URL after reading it
  useEffect(() => {
    if (!autoJoinPayload) return;
    const cleanUrl =
      window.location.pathname +
      window.location.search.replace(/[?&]bdp=[^&]*/g, "").replace(/^&/, "?") +
      window.location.hash;
    window.history.replaceState(null, "", cleanUrl || window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Peer & connection tracking refs ────────────────────────────────────────
  const setupPeersRef = useRef<Set<string>>(new Set());
  const toastedPeersRef = useRef<Set<string>>(new Set());
  const previousReadyPeersRef = useRef<string[]>([]);
  const connectionFailedToastShownRef = useRef(false);
  const previousConnectionStateRef = useRef<string | null>(null);
  const joinedSessionsRef = useRef<Set<string>>(new Set());
  const previousSendErrorRef = useRef<string | null>(null);
  const previousReceiveErrorRef = useRef<string | null>(null);

  const shareableUrl = session.session
    ? createShareableUrl(session.session.id)
    : "";

  // ── QR scan handler ─────────────────────────────────────────────────────────
  const handleQRScanSuccess = useCallback(
    (sessionId: string) => {
      if (joinedSessionsRef.current.has(sessionId)) return;
      joinedSessionsRef.current.add(sessionId);
      joinSession(sessionId);
      const newHash = `#${sessionId}`;
      if (window.location.hash !== newHash) {
        window.history.pushState(null, "", newHash);
      }
      const description = "Connecting…";
      const icon = "📱";
      toast.success("Session joined", { description, icon, duration: 3000 });
    },
    [joinSession],
  );

  // ── Effect: set up receivers for new ready peers ────────────────────────────

  const previousSendCompleteRef = useRef(false);
  const previousReceiveCompleteRef = useRef(false);

  useEffect(() => {
    const previousState = previousConnectionStateRef.current;
    previousConnectionStateRef.current = connectionState;

    if (
      connectionState === "failed" &&
      previousState !== "failed" &&
      !connectionFailedToastShownRef.current
    ) {
      connectionFailedToastShownRef.current = true;
      toast.error("Connection failed", {
        description: "Could not establish a peer connection.",
        duration: 5000,
      });
    }
    if (connectionState !== "failed") {
      connectionFailedToastShownRef.current = false;
    }
  }, [connectionState]);

  useEffect(() => {
    const currentSet = new Set(readyPeers);
    const previousSet = new Set(previousReadyPeersRef.current);

    const newPeers = readyPeers.filter((id) => !previousSet.has(id));
    const goneIds = previousReadyPeersRef.current.filter(
      (id) => !currentSet.has(id),
    );

    newPeers.forEach((id) => {
      const peer = peers.find((p) => p.id === id);
      const peerName = peer?.name ?? "A device";

      if (!setupPeersRef.current.has(id)) {
        setupPeersRef.current.add(id);
        const dataChannel = getDataChannelForPeer(id);
        if (dataChannel && dataChannel.readyState === "open") {
          const queuedMessages = getQueuedMessagesForPeer(id);
          setupReceiver(id, peerName, dataChannel, queuedMessages);
        }
      }

      if (!toastedPeersRef.current.has(id)) {
        toastedPeersRef.current.add(id);
        playConnect();
        toast.success(`${peerName} connected`, {
          id: `connected-${id}`,
          icon: "🔗",
          duration: 3000,
        });
      }
    });

    goneIds.forEach((id) => {
      const peer = peers.find((p) => p.id === id);
      const peerName = peer?.name ?? "A device";
      setupPeersRef.current.delete(id);
      toastedPeersRef.current.delete(id);
      cleanupPeer(id);
      toast.info(`${peerName} disconnected`, {
        id: `disconnected-${id}`,
        icon: "👋",
        duration: 3000,
      });
      if (selectedPeerId === id) setSelectedPeerId(undefined);
    });

    previousReadyPeersRef.current = readyPeers;
  }, [
    readyPeers,
    peers,
    setupReceiver,
    getDataChannelForPeer,
    getQueuedMessagesForPeer,
    cleanupPeer,
    playConnect,
    selectedPeerId,
  ]);

  // Toast on send complete
  useEffect(() => {
    if (sendComplete && !previousSendCompleteRef.current) {
      previousSendCompleteRef.current = true;
      playSuccess();
      const peerName = sendCompletePeerName ?? "peer";
      const fileCount = selectedFiles.length || 1;
      toast.success(`${fileCount} file${fileCount !== 1 ? "s" : ""} sent!`, {
        id: "send-complete",
        icon: "🎉",
        description: `Successfully sent to ${peerName}`,
        duration: 4000,
      });
    }
    if (!sendComplete) previousSendCompleteRef.current = false;
  }, [sendComplete, sendProgress, sendCompletePeerName, playSuccess]);

  // Toast on receive complete
  useEffect(() => {
    if (receiveComplete && !previousReceiveCompleteRef.current) {
      previousReceiveCompleteRef.current = true;
      playFileReceived();
      toast.success("Files received!", {
        id: "receive-complete",
        icon: "📥",
        description: `From ${receiveCompletePeerName ?? "peer"}`,
        duration: 4000,
      });
    }
    if (!receiveComplete) previousReceiveCompleteRef.current = false;
  }, [receiveComplete, receiveCompletePeerName, playFileReceived]);

  // Toast on send error
  useEffect(() => {
    if (sendError && sendError !== previousSendErrorRef.current) {
      previousSendErrorRef.current = sendError;
      playError();
      toast.error("Send failed", { description: sendError, duration: 5000 });
    }
    if (!sendError) previousSendErrorRef.current = null;
  }, [sendError, playError]);

  // Toast on receive error
  useEffect(() => {
    if (receiveError && receiveError !== previousReceiveErrorRef.current) {
      previousReceiveErrorRef.current = receiveError;
      playError();
      toast.error("Receive failed", {
        description: receiveError,
        duration: 5000,
      });
    }
    if (!receiveError) previousReceiveErrorRef.current = null;
  }, [receiveError, playError]);

  // ── File drop (global drag-over-app) ───────────────────────────────────────
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
        description: "Tap a connected device to select it",
      });
      return;
    }
    const peer = peers.find((p) => p.id === selectedPeerId);
    const peerName = peer?.name || "peer";
    if (!isPeerReady(selectedPeerId)) {
      toast.info(`Connecting to ${peerName}…`, {
        description: "Please wait a moment",
        icon: "⏳",
        duration: 3000,
      });
      return;
    }
    const dataChannel = getDataChannelForPeer(selectedPeerId);
    if (!dataChannel || dataChannel.readyState !== "open") {
      toast.error(`Cannot connect to ${peerName}`, {
        description: "Connection lost. Try refreshing the page.",
        icon: "❌",
      });
      return;
    }
    try {
      playTransferStart();
      await sendFiles(selectedFiles, dataChannel, selectedPeerId, peerName);
      setTimeout(() => setSelectedFiles([]), 2000);
    } catch (error) {
      console.error("Failed to send files:", error);
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

  // Auto-select first peer when peers are discovered
  useEffect(() => {
    if (peers.length > 0 && !selectedPeerId) {
      const timer = setTimeout(() => setSelectedPeerId(peers[0].id), 100);
      return () => clearTimeout(timer);
    }
  }, [peers, selectedPeerId]);

  const canSend =
    selectedFiles.length > 0 &&
    !isSending &&
    selectedPeerId &&
    isPeerReady(selectedPeerId);

  const selectedPeerName = selectedPeerId
    ? peers.find((p) => p.id === selectedPeerId)?.name || "peer"
    : "";

  // ── BDP badge counts ────────────────────────────────────────────────────────
  const bdpConflictCount = useMemo(
    () =>
      [...bdp.engineStates.values()].filter(
        (s) => s.phase === "resolving_conflict",
      ).length,
    [bdp.engineStates],
  );
  const bdpSyncingCount = useMemo(
    () =>
      [...bdp.engineStates.values()].filter(
        (s) =>
          s.phase === "transferring" ||
          s.phase === "diffing" ||
          s.phase === "delta_sync" ||
          s.phase === "full_sync",
      ).length,
    [bdp.engineStates],
  );

  const bdpConflictState = activeConflictPairId
    ? bdp.engineStates.get(activeConflictPairId)
    : undefined;
  const bdpVaultPair = vaultPairId
    ? (bdp.pairs.find((p) => p.pairId === vaultPairId) ?? null)
    : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen relative" {...getRootProps()}>
      <input {...getInputProps()} />

      {showWarmupOverlay && (
        <ServerWarmupOverlay status={warmupStatus} elapsed={warmupElapsed} />
      )}

      <AmbientBackground />

      {/* Global drag overlay — only shown on the Send tab */}
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

      {/* ── App shell ── */}
      <div
        className="relative min-h-screen flex flex-col"
        style={{ zIndex: 10 }}
      >
        {/* ── Header ── */}
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border/50 backdrop-blur-sm bg-background/50 shrink-0">
          {/* Logo + name */}
          <div className="flex items-center gap-2.5 min-w-0">
            <ButterflyLogo />
            <div className="min-w-0 hidden sm:block">
              <h1 className="text-base font-semibold leading-none truncate">
                Butterfly Drop
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Let your files fly
              </p>
            </div>
          </div>

          {/* ── Tab toggle — the single source of truth for mode ── */}
          <div className="flex items-center p-1 rounded-xl bg-muted/60 border border-border/50 gap-0.5">
            <button
              onClick={() => setActiveTab("send")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200",
                activeTab === "send"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Send className="h-3.5 w-3.5" />
              Send Files
            </button>

            <button
              onClick={() => setActiveTab("sync")}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200",
                activeTab === "sync"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  bdpSyncingCount > 0 && "animate-spin",
                )}
              />
              Sync Pairs
              {/* Activity badge */}
              {bdpConflictCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] text-white font-bold">
                  {bdpConflictCount}
                </span>
              )}
              {bdpConflictCount === 0 && bdpSyncingCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                </span>
              )}
            </button>
          </div>

          {/* Right toolbar */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {shareableUrl && (
              <div className="hidden sm:block">
                <ShareLink url={shareableUrl} />
              </div>
            )}
            <QRScanner onScanSuccess={handleQRScanSuccess} />
            <ConnectionStatus
              peerCount={readyPeers.length}
              sessionId={session.session?.id || null}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                window.open("https://github.com/a-saed/ButterflyDrop", "_blank")
              }
              className="h-9 w-9 hidden sm:flex"
              aria-label="View on GitHub"
            >
              <Github className="h-4 w-4" />
            </Button>
            <ThemeToggle />
          </div>
        </header>

        {/* ── Tab content ── */}
        <main className="flex-1 relative overflow-hidden">
          {/* ══════════════════════════════════════════════════════════════
              TAB 1 — SEND FILES
              Full-screen peer network + bottom action panel.
              No mention of sync pairs anywhere in this tab.
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === "send" && (
            <>
              {/* Peer network — spatial, full area */}
              <div className="absolute inset-0">
                <PeerNetwork
                  peers={peers}
                  selectedPeerId={selectedPeerId}
                  onPeerSelect={handlePeerSelect}
                  hasFiles={selectedFiles.length > 0}
                  readyPeers={readyPeers}
                />
              </div>

              {/* Bottom action panel */}
              <div className="absolute bottom-0 left-0 right-0 px-4 sm:px-6 pb-4 sm:pb-6">
                <div className="max-w-2xl mx-auto space-y-3">
                  {/* Share link on mobile (hidden in header) */}
                  {shareableUrl && (
                    <div className="sm:hidden">
                      <ShareLink url={shareableUrl} />
                    </div>
                  )}

                  {/* ── Active transfer ── */}
                  {(isSending || sendComplete || sendError) && (
                    <SendProgressPanel
                      isSending={isSending}
                      sendProgress={sendProgress}
                      sendComplete={sendComplete}
                      sendError={sendError}
                      peerName={
                        sendingToPeer
                          ? peers.find((p) => p.id === sendingToPeer)?.name ||
                            "peer"
                          : selectedPeerName
                      }
                      onReset={resetSendState}
                    />
                  )}

                  {/* ── Idle / file-selection panel ── */}
                  {!isSending && !sendComplete && !sendError && (
                    <>
                      {/* State A — files staged, ready to send */}
                      {selectedFiles.length > 0 && (
                        <div className="bg-background/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl overflow-hidden">
                          <div className="p-4">
                            <FileList
                              files={selectedFiles}
                              onRemove={handleRemoveFile}
                              onClear={handleClearFiles}
                            />
                          </div>

                          {/* Footer: peer selector + send button */}
                          <div className="px-4 pb-4 pt-3 border-t border-border/40 flex items-center gap-3">
                            {readyPeers.length > 1 && (
                              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/60 bg-muted/40 text-xs font-medium text-muted-foreground cursor-pointer hover:bg-muted/70 transition-colors">
                                <span className="truncate max-w-30">
                                  {selectedPeerName}
                                </span>
                                <ChevronDown className="h-3 w-3 shrink-0" />
                              </div>
                            )}

                            <div className="flex-1 flex justify-end items-center gap-3">
                              {canSend && (
                                <Button
                                  size="lg"
                                  onClick={handleSend}
                                  className="gap-2 h-11 px-6 text-sm font-semibold shadow-lg hover:shadow-xl transition-all"
                                >
                                  <Send className="h-4 w-4" />
                                  Send to {selectedPeerName}
                                </Button>
                              )}

                              {!canSend && peers.length === 0 && (
                                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Link2 className="h-4 w-4 shrink-0" />
                                  Share your link to connect a device first
                                </p>
                              )}

                              {!canSend &&
                                peers.length > 0 &&
                                selectedPeerId &&
                                !isPeerReady(selectedPeerId) && (
                                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                    Connecting to {selectedPeerName}…
                                  </p>
                                )}

                              {!canSend &&
                                peers.length > 0 &&
                                !selectedPeerId && (
                                  <p className="text-sm text-muted-foreground">
                                    Tap a device above to select it
                                  </p>
                                )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* State B — no files yet */}
                      {selectedFiles.length === 0 && (
                        <div className="bg-background/90 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl overflow-hidden">
                          {/* Step strip */}
                          <div className="flex items-center gap-0 border-b border-border/40 px-4 py-2.5 bg-muted/20">
                            {/* Step 1 */}
                            <div
                              className={cn(
                                "flex items-center gap-1.5 text-xs font-medium transition-colors",
                                readyPeers.length > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-primary",
                              )}
                            >
                              {readyPeers.length > 0 ? (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <span className="h-4 w-4 rounded-full border-2 border-current flex items-center justify-center text-[10px] font-bold shrink-0">
                                  1
                                </span>
                              )}
                              <span className="hidden sm:inline">
                                Connect device
                              </span>
                              <span className="sm:hidden">Connect</span>
                            </div>

                            <div className="w-6 h-px bg-border/60 mx-2 shrink-0" />

                            {/* Step 2 */}
                            <div
                              className={cn(
                                "flex items-center gap-1.5 text-xs font-medium",
                                readyPeers.length > 0
                                  ? "text-primary"
                                  : "text-muted-foreground",
                              )}
                            >
                              <span
                                className={cn(
                                  "h-4 w-4 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shrink-0",
                                  readyPeers.length > 0
                                    ? "border-primary"
                                    : "border-muted-foreground/40",
                                )}
                              >
                                2
                              </span>
                              <span className="hidden sm:inline">
                                Drop your files
                              </span>
                              <span className="sm:hidden">Add files</span>
                            </div>

                            <div className="w-6 h-px bg-border/60 mx-2 shrink-0" />

                            {/* Step 3 */}
                            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                              <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 flex items-center justify-center text-[10px] font-bold shrink-0">
                                3
                              </span>
                              <span>Send</span>
                            </div>

                            {/* Active peer badge */}
                            {readyPeers.length > 0 && selectedPeerId && (
                              <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="truncate max-w-25">
                                  {selectedPeerName}
                                </span>
                              </div>
                            )}
                            {readyPeers.length > 0 && !selectedPeerId && (
                              <span className="ml-auto text-xs text-muted-foreground italic">
                                Tap a device ↑
                              </span>
                            )}
                          </div>

                          {/* Drop zone body */}
                          <div className="p-4">
                            {readyPeers.length === 0 ? (
                              /* No peer yet */
                              <div className="flex flex-col sm:flex-row items-center gap-4 py-1">
                                <div className="flex-1 text-center sm:text-left">
                                  <p className="text-sm font-medium mb-1">
                                    Waiting for a device to connect
                                  </p>
                                  <p className="text-xs text-muted-foreground leading-relaxed">
                                    Share your link or QR code — once the other
                                    device opens it, you'll be connected
                                    instantly.
                                  </p>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5 text-xs shrink-0"
                                  onClick={() =>
                                    document
                                      .getElementById("file-input-app")
                                      ?.click()
                                  }
                                >
                                  <FileUp className="h-3.5 w-3.5" />
                                  Pick files anyway
                                </Button>
                              </div>
                            ) : (
                              /* Peer ready — dashed drop zone */
                              <div
                                className={cn(
                                  "group flex flex-col sm:flex-row items-center gap-4",
                                  "border-2 border-dashed rounded-xl p-4 transition-all duration-200 cursor-pointer",
                                  isDragActive
                                    ? "border-primary bg-primary/5 scale-[1.01]"
                                    : "border-border/50 hover:border-primary/40 hover:bg-muted/30",
                                )}
                                onClick={() =>
                                  document
                                    .getElementById("file-input-app")
                                    ?.click()
                                }
                              >
                                <div
                                  className={cn(
                                    "flex items-center justify-center h-14 w-14 rounded-2xl shrink-0 transition-colors pointer-events-none",
                                    isDragActive
                                      ? "bg-primary/10 text-primary"
                                      : "bg-muted/60 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
                                  )}
                                >
                                  <Upload
                                    className={cn(
                                      "h-7 w-7",
                                      isDragActive && "animate-bounce",
                                    )}
                                  />
                                </div>

                                <div className="flex-1 text-center sm:text-left pointer-events-none">
                                  <p className="text-sm font-semibold mb-0.5">
                                    {isDragActive
                                      ? "Release to add files"
                                      : "Drop files or folders here"}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {isDragActive
                                      ? `Will send to ${selectedPeerName}`
                                      : "Sent directly to the connected device — no upload, no cloud"}
                                  </p>
                                </div>

                                {!isDragActive && (
                                  <Button
                                    variant="default"
                                    size="sm"
                                    className="gap-1.5 text-xs h-9 shrink-0 pointer-events-none"
                                    tabIndex={-1}
                                  >
                                    <FileUp className="h-3.5 w-3.5" />
                                    Browse files
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Hidden file input */}
                  <input
                    id="file-input-app"
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
                        // Reset input so the same file can be re-added
                        e.target.value = "";
                      }
                    }}
                  />
                </div>
              </div>

              {/* Received files panel — floats bottom-right, send tab only */}
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
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB 2 — SYNC PAIRS (BDP)
              Full-screen sync dashboard. No peer avatars, no drop zones.
              This is the dedicated space for persistent folder sync setup.
          ══════════════════════════════════════════════════════════════ */}
          {activeTab === "sync" && (
            <div className="absolute inset-0 overflow-y-auto">
              <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
                {/* Init error */}
                {bdp.initError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10 px-3 py-2.5">
                    <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {bdp.initError.message}
                    </p>
                  </div>
                )}

                {/* Active sync progress banners */}
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

                {/* Conflict resolver */}
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
                  )}

                {/* Vault browser or dashboard */}
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
                    onViewVault={(pairId) => setVaultPairId(pairId)}
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

                {/* Quick "Add pair" shortcut at the bottom when pairs exist */}
                {bdp.pairs.length > 0 && !vaultPairId && (
                  <div className="flex justify-center pb-4">
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
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── Add Pair Dialog ─────────────────────────────────────────────────── */}
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
