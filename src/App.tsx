import { useState, useCallback, useEffect, useRef } from "react";
import { SessionProvider } from "@/contexts/SessionContext";
import { ConnectionProvider } from "@/contexts/ConnectionContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useSession } from "@/hooks/useSession";
import { usePeerDiscovery } from "@/hooks/usePeerDiscovery";
import { useWebRTC } from "@/hooks/useWebRTC_v2";
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
import { Upload, Send, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDropzone } from "react-dropzone";
import { useSoundEffects } from "@/hooks/useSoundEffects";

function AppContent() {
  const session = useSession();
  const { joinSession } = session;
  const { peers, isScanning } = usePeerDiscovery();
  const { connectionState } = useConnection();
  const { getDataChannelForPeer, getQueuedMessagesForPeer, isPeerReady, readyPeers } = useWebRTC();
  const { playConnect, playTransferStart, playSuccess, playFileReceived, playError } = useSoundEffects();
  
  // File transfer with new API
  const {
    // Sending state
    isSending,
    sendingToPeer,
    sendProgress,
    sendComplete,
    sendError,
    // Receiving state  
    isReceiving,
    receivingFromPeer,
    receiveProgress,
    receiveComplete,
    receiveError,
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
    // Helpers
    formatBytes,
  } = useFileTransfer();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string>();
  
  // Track which peers have receivers set up
  const setupPeersRef = useRef<Set<string>>(new Set());
  // Track if we've already shown connection failed toast
  const connectionFailedToastShownRef = useRef(false);
  const previousConnectionStateRef = useRef<string | null>(null);
  // Track which sessions we've already joined (to prevent duplicate toasts)
  const joinedSessionsRef = useRef<Set<string>>(new Set());

  const shareableUrl = session.session
    ? createShareableUrl(session.session.id)
    : "";

  // Handle QR code scan success
  const handleQRScanSuccess = useCallback((sessionId: string) => {
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
  }, [joinSession, session.session]);

  // Setup file receiver for all ready peers
  // This is CRITICAL - must set up onmessage handler before files arrive
  useEffect(() => {
    if (session.session && readyPeers.length > 0) {
      readyPeers.forEach((peerId) => {
        // Skip if already set up
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
  }, [session.session, readyPeers, peers, getDataChannelForPeer, getQueuedMessagesForPeer, setupReceiver]);

  // Track previous ready peers count for sound effects
  const previousReadyPeersCountRef = useRef(0);

  // Show connection status when peers become ready
  useEffect(() => {
    const previousState = previousConnectionStateRef.current;
    previousConnectionStateRef.current = connectionState;

    if (readyPeers.length > 0) {
      const newPeers = readyPeers.filter((id) => !setupPeersRef.current.has(id));
      if (newPeers.length > 0) {
        const peerNames = peers
          .filter((p) => newPeers.includes(p.id))
          .map((p) => p.name)
          .join(", ");

        if (peerNames) {
          toast.success(`Connected with ${peerNames}`, {
            icon: "🦋",
            duration: 3000,
          });
          // Play connection sound when new peers connect
          if (readyPeers.length > previousReadyPeersCountRef.current) {
            playConnect();
          }
        }
      }
      previousReadyPeersCountRef.current = readyPeers.length;
      // Reset failed toast flag when connection succeeds
      connectionFailedToastShownRef.current = false;
    } else if (connectionState === "failed" && previousState !== "failed") {
      // Only show toast when transitioning TO failed state, not repeatedly
      if (!connectionFailedToastShownRef.current) {
        connectionFailedToastShownRef.current = true;
        toast.error("Connection failed", {
          description: "Check your network and try refreshing",
          duration: 4000,
        });
        playError();
      }
    } else if (connectionState !== "failed") {
      // Reset flag when connection state changes away from failed
      connectionFailedToastShownRef.current = false;
    }
  }, [connectionState, readyPeers, peers, playConnect, playError]);

  // Show send errors
  useEffect(() => {
    if (sendError) {
      toast.error("Send failed", {
        description: sendError,
        duration: 4000,
      });
      playError();
    }
  }, [sendError, playError]);

  // Show receive errors
  useEffect(() => {
    if (receiveError) {
      toast.error("Receive failed", {
        description: receiveError,
        duration: 4000,
      });
      playError();
    }
  }, [receiveError, playError]);

  // Track previous send complete state for sound effects
  const previousSendCompleteRef = useRef(false);
  const previousReceiveCompleteRef = useRef(false);

  // Show send complete notification and play sound
  useEffect(() => {
    if (sendComplete && !previousSendCompleteRef.current) {
      playSuccess();
      previousSendCompleteRef.current = true;
    } else if (!sendComplete) {
      previousSendCompleteRef.current = false;
    }
  }, [sendComplete, playSuccess]);

  // Show receive complete notification
  useEffect(() => {
    if (receiveComplete && receivedFiles.length > 0) {
      const peerName = incomingTransfer?.peerName || 
        (receivingFromPeer ? peers.find((p) => p.id === receivingFromPeer)?.name : null) || 
        "peer";
      toast.success(
        `${receivedFiles.length} file${receivedFiles.length > 1 ? "s" : ""} received from ${peerName}!`,
        {
          icon: "✅",
          description: "Click to download",
          duration: 5000,
        },
      );
      // Play file received sound
      if (!previousReceiveCompleteRef.current) {
        playFileReceived();
        previousReceiveCompleteRef.current = true;
      }
    } else if (!receiveComplete) {
      previousReceiveCompleteRef.current = false;
    }
  }, [receiveComplete, receivedFiles.length, incomingTransfer, receivingFromPeer, peers, playFileReceived]);

  // File drop handling
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...acceptedFiles]);
      toast.success(
        `${acceptedFiles.length} file${acceptedFiles.length > 1 ? "s" : ""} added`,
        { icon: "📁" }
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

  const handlePeerSelect = useCallback((peerId: string) => {
        setSelectedPeerId(peerId);
          const peer = peers.find((p) => p.id === peerId);
    if (peer && selectedFiles.length > 0) {
      toast.info(`Ready to send to ${peer.name}`, { icon: "📱", duration: 2000 });
        }
  }, [selectedFiles, peers]);

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

  return (
    <div className="min-h-screen relative" {...getRootProps()}>
      <input {...getInputProps()} />

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
      <div className="relative min-h-screen flex flex-col" style={{ zIndex: 10 }}>
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 p-4 sm:p-6 border-b border-border/50 backdrop-blur-sm bg-background/50">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <ButterflyLogo />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold truncate">Butterfly Drop</h1>
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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.open("https://github.com/a-saed/ButterflyDrop", "_blank")}
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
                peerName={sendingToPeer ? peers.find((p) => p.id === sendingToPeer)?.name || "peer" : selectedPeerName}
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
                            Send {selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""} to {selectedPeerName}
                      </Button>
                    </div>
                  )}

                      {/* Waiting for peer */}
                      {selectedFiles.length > 0 && !canSend && peers.length === 0 && (
                        <div className="text-center mt-4 text-sm text-muted-foreground">
                          <p>Share the link above to connect with another device</p>
                        </div>
                      )}

                      {/* Waiting for connection */}
                      {selectedFiles.length > 0 && !canSend && peers.length > 0 && selectedPeerId && !isPeerReady(selectedPeerId) && (
                      <div className="text-center mt-4 text-sm text-muted-foreground">
                          <p>Establishing connection with {selectedPeerName}...</p>
                      </div>
                    )}
                </div>
              ) : (
                <div className="bg-background/80 backdrop-blur-sm border border-border/50 rounded-2xl p-6 text-center">
                  <Upload className="h-10 w-10 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-3">
                        {peers.length > 0 
                          ? "Drop files anywhere or click to select"
                          : "Scan a QR code or share the link to connect, then drop files to send"
                        }
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                        onClick={() => document.getElementById("file-input")?.click()}
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
                      { icon: "📁" }
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

      <Toaster />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <ConnectionProvider>
          <AppContent />
        </ConnectionProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

export default App;
