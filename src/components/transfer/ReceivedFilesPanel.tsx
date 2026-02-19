import {
  FileDown,
  Download,
  X,
  CheckCircle2,
  File,
  Image,
  Video,
  Music,
  FileText,
  Archive,
  FolderSync,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ButterflyProgress } from "@/components/transfer/ButterflyProgress";
import type { ReceivedFile, IncomingTransfer } from "@/hooks/useFileTransfer";
import type { TransferProgress } from "@/types/transfer";

interface ReceivedFilesPanelProps {
  // Incoming transfer (while receiving)
  incomingTransfer: IncomingTransfer | null;
  receiveProgress: TransferProgress | null;
  isReceiving: boolean;

  // Received files (after transfer complete)
  receivedFiles: ReceivedFile[];
  receiveComplete: boolean;

  // Actions
  onDownloadFile: (file: ReceivedFile) => void;
  onDownloadAll: (files?: ReceivedFile[]) => void;
  onClear: () => void;

  // Helpers
  formatBytes: (bytes: number) => string;
}

/**
 * Get icon for file type
 */
function getFileIcon(type: string) {
  if (type.startsWith("image/")) return <Image className="h-4 w-4" />;
  if (type.startsWith("video/")) return <Video className="h-4 w-4" />;
  if (type.startsWith("audio/")) return <Music className="h-4 w-4" />;
  if (
    type.startsWith("text/") ||
    type.includes("document") ||
    type.includes("pdf")
  )
    return <FileText className="h-4 w-4" />;
  if (
    type.includes("zip") ||
    type.includes("rar") ||
    type.includes("tar") ||
    type.includes("compressed")
  )
    return <Archive className="h-4 w-4" />;
  return <File className="h-4 w-4" />;
}

export function ReceivedFilesPanel({
  incomingTransfer,
  receiveProgress,
  isReceiving,
  receivedFiles,
  receiveComplete,
  onDownloadFile,
  onDownloadAll,
  onClear,
  formatBytes,
}: ReceivedFilesPanelProps) {
  // Show receiving progress
  if (isReceiving && receiveProgress) {
    return (
      <Card className="fixed bottom-6 right-6 p-4 w-96 shadow-2xl border-primary/50 bg-background/95 backdrop-blur-sm z-50 animate-in slide-in-from-right-5">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
              <FileDown className="h-5 w-5 text-blue-500 animate-bounce" />
            </div>
            <div className="flex-1 min-w-0">
              {incomingTransfer?.folderName && (
                <div className="flex items-center gap-1 mb-0.5">
                  <FolderSync className="h-3 w-3 text-primary" />
                  <span className="text-xs font-semibold text-primary truncate">
                    {incomingTransfer.folderName}
                  </span>
                </div>
              )}
              <p className="text-sm font-medium">
                {incomingTransfer?.folderName ? "Folder sync" : "Receiving"}{" "}
                from {incomingTransfer?.peerName || "peer"}
              </p>
              <p className="text-xs text-muted-foreground">
                {incomingTransfer?.files.length || 0} file
                {(incomingTransfer?.files.length || 0) > 1 ? "s" : ""}
                {" · "}
                {formatBytes(receiveProgress.totalBytes)}
              </p>
            </div>
          </div>

          {/* Current file with butterfly progress */}
          <ButterflyProgress progress={receiveProgress} />
        </div>
      </Card>
    );
  }

  // Show received files
  if (receiveComplete && receivedFiles.length > 0) {
    // Debug: log file state
    console.log(
      `🎨 ReceivedFilesPanel rendering with ${receivedFiles.length} files:`,
    );
    receivedFiles.forEach((f, i) => {
      console.log(
        `   ${i}: ${f.metadata.name} - chunks: ${f.chunks?.length}, complete: ${f.isComplete}`,
      );
    });

    // Check if any files have missing chunks
    const filesWithMissingChunks = receivedFiles.filter(
      (f) => !f.chunks || f.chunks.length === 0,
    );

    return (
      <Card className="fixed bottom-6 right-6 p-4 w-96 max-h-[70vh] shadow-2xl border-green-500/50 bg-background/95 backdrop-blur-sm z-50 animate-in slide-in-from-right-5">
        <div className="space-y-4">
          {/* Folder sync badge */}
          {receivedFiles.length > 0 && incomingTransfer?.folderName && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <FolderSync className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-xs font-medium text-primary truncate">
                Folder sync: {incomingTransfer.folderName}
              </span>
            </div>
          )}

          {/* Debug info */}
          {filesWithMissingChunks.length > 0 && (
            <div className="p-2 bg-red-500/10 border border-red-500/50 rounded text-xs text-red-500">
              ⚠️ {filesWithMissingChunks.length} file(s) have no chunk data
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {incomingTransfer?.folderName
                    ? "Folder Synced!"
                    : "Files Received!"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {receivedFiles.length} file
                  {receivedFiles.length > 1 ? "s" : ""} ready to download
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClear}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* File list */}
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {receivedFiles.map((file, index) => (
              <div
                key={file.metadata.id || index}
                className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
              >
                <div className="h-8 w-8 rounded bg-background flex items-center justify-center shrink-0">
                  {getFileIcon(file.metadata.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {file.metadata.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.totalReceived)} /{" "}
                    {formatBytes(file.metadata.size)}
                    {" • "}
                    <span
                      className={
                        file.chunks?.length > 0
                          ? "text-green-500"
                          : "text-red-500"
                      }
                    >
                      {file.chunks?.length || 0} chunks
                    </span>
                    {!file.isComplete && file.chunks?.length > 0 && (
                      <span className="text-yellow-500"> • incomplete</span>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    console.log(
                      `🖱️ Download button clicked for: ${file.metadata.name}`,
                    );
                    console.log(`   isComplete: ${file.isComplete}`);
                    console.log(`   chunks: ${file.chunks?.length}`);
                    console.log(`   totalReceived: ${file.totalReceived}`);
                    console.log(`   expectedSize: ${file.metadata.size}`);
                    if (!file.chunks || file.chunks.length === 0) {
                      alert(
                        `Debug: File "${file.metadata.name}" has no chunks! isComplete=${file.isComplete}`,
                      );
                      return;
                    }
                    onDownloadFile(file);
                  }}
                  className="h-8 w-8 shrink-0"
                  disabled={!file.chunks || file.chunks.length === 0}
                  title={
                    file.isComplete
                      ? "Download"
                      : `Partial download (${file.chunks?.length || 0} chunks)`
                  }
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t">
            <Button
              onClick={() => {
                console.log(`🖱️ Download All clicked`);
                console.log(`   Files count: ${receivedFiles.length}`);
                receivedFiles.forEach((f, i) => {
                  console.log(
                    `   File ${i}: ${f.metadata.name}, complete: ${f.isComplete}, chunks: ${f.chunks?.length}`,
                  );
                });
                // Pass files directly to avoid closure issues
                onDownloadAll(receivedFiles);
              }}
              className="flex-1 gap-2"
            >
              <Download className="h-4 w-4" />
              Download All
            </Button>
            <Button variant="outline" onClick={onClear}>
              Clear
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return null;
}
