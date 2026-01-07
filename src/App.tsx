import { useState, useCallback } from 'react'
import { SessionProvider } from '@/contexts/SessionContext'
import { ConnectionProvider } from '@/contexts/ConnectionContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { useSession } from '@/hooks/useSession'
import { usePeerDiscovery } from '@/hooks/usePeerDiscovery'
import { AmbientBackground } from '@/components/layout/AmbientBackground'
import { ButterflyLogo } from '@/components/layout/ButterflyLogo'
import { PeerNetwork } from '@/components/peer/PeerNetwork'
import { FileList } from '@/components/transfer/FileList'
import { TransferProgress } from '@/components/transfer/TransferProgress'
import { ShareLink } from '@/components/connection/ShareLink'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { createShareableUrl } from '@/lib/sessionUtils'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import type { TransferProgress as TransferProgressType } from '@/types/transfer'
import { Upload, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDropzone } from 'react-dropzone'

function AppContent() {
  const session = useSession()
  const { peers, isScanning } = usePeerDiscovery()
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedPeerId, setSelectedPeerId] = useState<string>()
  const [transferProgress, setTransferProgress] = useState<{
    progress: TransferProgressType | null
    isComplete: boolean
  } | null>(null)

  const shareableUrl = session.session ? createShareableUrl(session.session.id) : ''

  // File drop handling
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...acceptedFiles])
      toast.success(`${acceptedFiles.length} file${acceptedFiles.length > 1 ? 's' : ''} added`)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  })

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleClearFiles = useCallback(() => {
    setSelectedFiles([])
  }, [])

  const handleSend = useCallback(() => {
    if (selectedFiles.length === 0 || !selectedPeerId) return

    const peer = peers.find((p) => p.id === selectedPeerId)
    if (!peer) return

    toast.success(`Sending to ${peer.name}...`, {
      icon: '🦋',
    })

    const file = selectedFiles[0]
    const totalBytes = file.size
    const speed = 1024 * 1024 * 5 // 5 MB/s

    // Simulate transfer
    setTransferProgress({
      progress: {
        fileId: 'demo-1',
        fileName: file.name,
        percentage: 0,
        bytesTransferred: 0,
        totalBytes,
        speed,
        eta: Math.ceil(totalBytes / speed),
      },
      isComplete: false,
    })

    // Simulate progress
    let progress = 0
    const interval = setInterval(() => {
      progress += 5
      if (progress >= 100) {
        clearInterval(interval)
        setTimeout(() => {
          setTransferProgress({
            progress: null,
            isComplete: true,
          })
          toast.success('Transfer complete!', {
            icon: '✨',
            description: `${file.name} sent successfully`,
          })
          setTimeout(() => {
            setTransferProgress(null)
            setSelectedFiles([])
            setSelectedPeerId(undefined)
          }, 3000)
        }, 500)
      } else {
        setTransferProgress((prev) => {
          if (!prev || !prev.progress) return prev
          return {
            ...prev,
            progress: {
              ...prev.progress,
              percentage: progress,
              bytesTransferred: (prev.progress.totalBytes * progress) / 100,
              eta: Math.ceil(
                ((prev.progress.totalBytes * (100 - progress)) / 100) /
                  prev.progress.speed
              ),
            },
          }
        })
      }
    }, 200)
  }, [selectedFiles, selectedPeerId, peers])

  const handlePeerSelect = useCallback((peerId: string) => {
    setSelectedPeerId(peerId)
    if (selectedFiles.length > 0) {
      const peer = peers.find((p) => p.id === peerId)
      toast.info(`Ready to send to ${peer?.name}`, {
        icon: '📱',
      })
    }
  }, [selectedFiles, peers])

  const canSend = selectedFiles.length > 0 && selectedPeerId && !transferProgress

  return (
    <div className="min-h-screen relative" {...getRootProps()}>
      <input {...getInputProps()} />
      
      {/* Ambient Background */}
      <AmbientBackground />

      {/* Drag Overlay */}
      {isDragActive && (
        <div className="fixed inset-0 bg-primary/10 backdrop-blur-sm flex items-center justify-center" style={{ zIndex: 50 }}>
          <div className="text-center">
            <Upload className="h-24 w-24 text-primary mx-auto mb-4 animate-bounce" />
            <p className="text-2xl font-semibold text-primary">Drop files here</p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="relative min-h-screen flex flex-col" style={{ zIndex: 10 }}>
        {/* Header */}
        <header className="flex items-center justify-between p-6 border-b border-border/50 backdrop-blur-sm bg-background/50">
          <div className="flex items-center gap-3">
            <ButterflyLogo />
            <div>
              <h1 className="text-xl font-semibold">Butterfly Drop</h1>
              <p className="text-xs text-muted-foreground">Let your files fly</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {shareableUrl && (
              <div className="hidden md:block max-w-md">
                <ShareLink url={shareableUrl} />
              </div>
            )}
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
            <div className="max-w-4xl mx-auto space-y-4">{isScanning && (
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
                  
                  {/* Send Button */}
                  {canSend && (
                    <div className="flex justify-center mt-4">
                      <Button
                        size="lg"
                        onClick={handleSend}
                        className="gap-2 min-w-[240px] h-12 text-base shadow-lg hover:shadow-xl transition-all"
                      >
                        <Send className="h-5 w-5" />
                        Send to {peers.find((p) => p.id === selectedPeerId)?.name}
                      </Button>
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
                    onClick={() => document.getElementById('file-input')?.click()}
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
                    const files = Array.from(e.target.files)
                    setSelectedFiles((prev) => [...prev, ...files])
                    toast.success(`${files.length} file${files.length > 1 ? 's' : ''} added`)
                  }
                }}
              />

              {/* Transfer Progress */}
              {transferProgress && (
                <div className="bg-background/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl">
                  <TransferProgress
                    progress={transferProgress.progress}
                    isComplete={transferProgress.isComplete}
                  />
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      <Toaster />
    </div>
  )
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
  )
}

export default App
