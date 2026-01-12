import { useState, useCallback, useEffect } from "react";
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
import { TransferProgress } from "@/components/transfer/TransferProgress";
import { ShareLink } from "@/components/connection/ShareLink";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ConnectionStatus } from "@/components/connection/ConnectionStatus";
import { createShareableUrl } from "@/lib/sessionUtils";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Upload, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDropzone } from "react-dropzone";
import { ConnectionStatusDebug } from "@/components/debug/ConnectionStatus";

function AppContent() {
  const session = useSession();
  const { peers, isScanning } = usePeerDiscovery();
  const { connectionState } = useConnection();
  const { isConnected, dataChannel } = useWebRTC();
  const {
    currentTransfer,
    isTransferring,
    isComplete,
    error: transferError,
    sendFiles,
    setupReceiver,
  } = useFileTransfer();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string>();

  const shareableUrl = session.session
    ? createShareableUrl(session.session.id)
    : "";

  // Setup file receiver when data channel is ready (all peers can receive)
  useEffect(() => {
    if (session.session && dataChannel && isConnected) {
      setupReceiver();
    }
  }, [session.session, dataChannel, isConnected, setupReceiver]);

  // Show connection status
  useEffect(() => {
    if (connectionState === "connected" && isConnected) {
      toast.success("Connected to peer!", {
        icon: "🦋",
        description: session.peerName || "Ready to transfer files",
      });
    } else if (connectionState === "failed") {
      toast.error("Connection failed", {
        description: "Please check your network connection",
      });
    }
  }, [connectionState, isConnected, session.peerName]);

  // Show transfer errors
  useEffect(() => {
    if (transferError) {
      toast.error("Transfer error", {
        description: transferError,
      });
    }
  }, [transferError]);

  // File drop handling
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...acceptedFiles]);
      toast.success(
        `${acceptedFiles.length} file${acceptedFiles.length > 1 ? "s" : ""} added`,
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

    // Check if connected to P2P network
    if (!isConnected || !dataChannel) {
      toast.error("Not connected", {
        description: "Please wait for peers to connect",
      });
      return;
    }

    const peer = peers.find((p) => p.id === selectedPeerId);

    toast.success(
      `Sending ${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""}...`,
      {
        icon: "🦋",
        description: peer ? `to ${peer.name}` : undefined,
      },
    );

    try {
      await sendFiles(selectedFiles);

      // Clear files after successful transfer
      if (isComplete) {
        setTimeout(() => {
          setSelectedFiles([]);
          setSelectedPeerId(undefined);
        }, 2000);
      }
    } catch (error) {
      console.error("Failed to send files:", error);
      toast.error("Failed to send files", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [
    selectedFiles,
    selectedPeerId,
    peers,
    session.session?.role,
    isConnected,
    dataChannel,
    sendFiles,
    isComplete,
  ]);

  const handlePeerSelect = useCallback(
    (peerId: string) => {
      // Auto-select the connected peer (only one peer in link-based sessions)
      if (peers.length > 0 && peers[0].id === peerId) {
        setSelectedPeerId(peerId);
        if (selectedFiles.length > 0) {
          const peer = peers.find((p) => p.id === peerId);
          toast.info(`Ready to send to ${peer?.name}`, {
            icon: "📱",
          });
        }
      }
    },
    [selectedFiles, peers],
  );

  // Auto-select first peer when peers are discovered
  useEffect(() => {
    if (peers.length > 0 && !selectedPeerId) {
      // Use setTimeout to avoid cascading renders
      const timer = setTimeout(() => {
        setSelectedPeerId(peers[0].id);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [peers, selectedPeerId]);

  // Modern P2P: anyone can send files to anyone
  const canSend =
    selectedFiles.length > 0 &&
    isConnected &&
    !isTransferring &&
    !isComplete &&
    selectedPeerId; // Must have a peer selected

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
      <div
        className="relative min-h-screen flex flex-col"
        style={{ zIndex: 10 }}
      >
        {/* Header */}
        <header className="flex items-center justify-between p-6 border-b border-border/50 backdrop-blur-sm bg-background/50">
          <div className="flex items-center gap-3">
            <ButterflyLogo />
            <div>
              <h1 className="text-xl font-semibold">Butterfly Drop</h1>
              <p className="text-xs text-muted-foreground">
                Let your files fly
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {shareableUrl && (
              <div className="hidden md:block max-w-md">
                <ShareLink url={shareableUrl} />
              </div>
            )}
            <ConnectionStatus
              peerCount={peers.length}
              sessionId={session.session?.id || null}
            />
            <ThemeToggle />
          </div>
        </header>

        {/* Mobile Share Link */}
        {shareableUrl && (
          <div className="px-6 py-4 md:hidden border-b border-border/50">
            <ShareLink url={shareableUrl} />
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 relative">
          {/* Peer Network - Full screen spatial layout */}
          <div className="absolute inset-0">
            <PeerNetwork
              peers={peers}
              selectedPeerId={selectedPeerId}
              onPeerSelect={handlePeerSelect}
              hasFiles={selectedFiles.length > 0}
            />
          </div>

          {/* Bottom Panel - File Selection */}
          <div className="absolute bottom-0 left-0 right-0 px-6 pb-6">
            <div className="max-w-4xl mx-auto space-y-4">
              {isScanning && (
                <div className="text-center text-xs text-muted-foreground mb-2">
                  Scanning for devices...
                </div>
              )}

              {/* File Selection Area */}
              {selectedFiles.length > 0 ? (
                <div className="bg-background/95 backdrop-blur-xl border border-border/50 rounded-2xl p-4 shadow-2xl">
                  <FileList
                    files={selectedFiles}
                    onRemove={handleRemoveFile}
                    onClear={handleClearFiles}
                  />

                  {/* Send Button - Modern P2P: anyone can send */}
                  {canSend && (
                    <div className="flex justify-center mt-4">
                      <Button
                        size="lg"
                        onClick={handleSend}
                        disabled={!isConnected || isTransferring}
                        className="gap-2 min-w-60 h-12 text-base shadow-lg hover:shadow-xl transition-all"
                      >
                        <Send className="h-5 w-5" />
                        {isTransferring
                          ? "Sending..."
                          : `Send ${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} to ${peers.find((p) => p.id === selectedPeerId)?.name || "peer"}`}
                      </Button>
                    </div>
                  )}

                  {/* P2P Network Status */}
                  {!canSend && isConnected && selectedFiles.length > 0 && (
                    <div className="text-center mt-4 text-sm text-muted-foreground">
                      <p>Select a peer to send files to</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-background/80 backdrop-blur-sm border border-border/50 rounded-2xl p-6 text-center">
                  <Upload className="h-10 w-10 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-3">
                    Drop files anywhere or click to select
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
                    );
                  }
                }}
              />

              {/* Transfer Progress */}
              {(currentTransfer || isTransferring || isComplete) && (
                <div className="bg-background/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl">
                  <TransferProgress
                    progress={currentTransfer}
                    isComplete={isComplete}
                  />
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      <Toaster />
      <ConnectionStatusDebug />
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
