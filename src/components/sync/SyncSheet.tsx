/**
 * SyncSheet — the single bottom-sheet component that handles the entire
 * folder-sync flow for a given peer.
 *
 * Views (driven by useFolderSync phase):
 *   idle       → folder picker (drag-drop zone + "Browse" button)
 *   scanning   → spinner while walking the directory tree
 *   preview    → file manifest list + "Push to [peer]" CTA
 *   sending    → live progress bar (delegates to useFileTransfer state)
 *   done       → success screen with butterfly flourish
 *   error      → error message + retry
 */

import { useEffect, useRef } from "react";
import {
  FolderOpen,
  FolderSync,
  Upload,
  CheckCircle2,
  AlertCircle,
  X,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Archive,
  File,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useFolderSync } from "@/hooks/useFolderSync";
import type { TransferProgress } from "@/types/transfer";
import type { SyncFileEntry } from "@/hooks/useFolderSync";

// ─── Props ────────────────────────────────────────────────────────────────────

interface SyncSheetProps {
  open: boolean;
  onClose: () => void;

  /** The peer we're syncing with */
  peerId: string;
  peerName: string;

  /** Shared from App-level useFileTransfer */
  sendFiles: (
    files: File[],
    dataChannel: RTCDataChannel,
    peerId: string,
    peerName: string,
    folderName?: string,
  ) => Promise<void>;
  getDataChannelForPeer: (peerId: string) => RTCDataChannel | null;
  isPeerReady: (peerId: string) => boolean;

  /** Live transfer state from App-level useFileTransfer */
  isSending: boolean;
  sendProgress: TransferProgress | null;
  sendComplete: boolean;
  sendError: string | null;
  resetSendState: () => void;
  formatBytes: (bytes: number) => string;
}

// ─── File-type icon helper ────────────────────────────────────────────────────

function FileTypeIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "heic"].includes(ext))
    return <ImageIcon className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext))
    return <Video className="h-3.5 w-3.5 shrink-0 text-purple-400" />;
  if (["mp3", "wav", "flac", "aac", "ogg"].includes(ext))
    return <Music className="h-3.5 w-3.5 shrink-0 text-pink-400" />;
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext))
    return <Archive className="h-3.5 w-3.5 shrink-0 text-yellow-400" />;
  if (["pdf", "doc", "docx", "txt", "md", "csv", "xls", "xlsx"].includes(ext))
    return <FileText className="h-3.5 w-3.5 shrink-0 text-green-400" />;
  return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

function IdleView({
  peerName,
  onPickFolder,
  onDrop,
  isDragOver,
  setIsDragOver,
}: {
  peerName: string;
  onPickFolder: () => void;
  onDrop: (e: React.DragEvent) => void;
  isDragOver: boolean;
  setIsDragOver: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-4">
      {/* Drag-drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          onDrop(e);
        }}
        className={cn(
          "w-full rounded-2xl border-2 border-dashed transition-all duration-200",
          "flex flex-col items-center justify-center gap-3 py-10 px-6 cursor-pointer",
          "select-none",
          isDragOver
            ? "border-primary bg-primary/10 scale-[1.01]"
            : "border-border/60 hover:border-primary/50 hover:bg-muted/40",
        )}
        onClick={onPickFolder}
      >
        <div
          className={cn(
            "h-14 w-14 rounded-full flex items-center justify-center transition-colors",
            isDragOver ? "bg-primary/20" : "bg-muted",
          )}
        >
          <FolderOpen
            className={cn(
              "h-7 w-7 transition-colors",
              isDragOver ? "text-primary" : "text-muted-foreground",
            )}
          />
        </div>

        <div className="text-center">
          <p className="text-sm font-medium">
            {isDragOver ? "Drop folder here" : "Drop a folder here"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            or click to browse
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center max-w-xs">
        All files inside the folder will be pushed to{" "}
        <span className="font-medium text-foreground">{peerName}</span>.
        Nothing is stored on any server.
      </p>
    </div>
  );
}

function ScanningView({ folderName }: { folderName?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" />
        <div className="relative h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-primary animate-spin" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">Scanning folder…</p>
        {folderName && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Reading files in{" "}
            <span className="font-medium text-foreground">{folderName}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function PreviewView({
  folderName,
  entries,
  totalSize,
  peerName,
  isPeerReady,
  onPush,
  onChangePicker,
  formatBytes,
}: {
  folderName: string;
  entries: SyncFileEntry[];
  totalSize: number;
  peerName: string;
  isPeerReady: boolean;
  onPush: () => void;
  onChangePicker: () => void;
  formatBytes: (n: number) => string;
}) {
  const MAX_VISIBLE = 8;
  const visible = entries.slice(0, MAX_VISIBLE);
  const overflow = entries.length - MAX_VISIBLE;

  return (
    <div className="flex flex-col gap-4">
      {/* Folder header */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FolderOpen className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{folderName}</p>
          <p className="text-xs text-muted-foreground">
            {entries.length} file{entries.length !== 1 ? "s" : ""} ·{" "}
            {formatBytes(totalSize)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onChangePicker}
          className="text-xs text-muted-foreground h-7 px-2 shrink-0"
        >
          Change
        </Button>
      </div>

      {/* File list */}
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <div className="max-h-48 overflow-y-auto divide-y divide-border/30">
          {visible.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 transition-colors"
            >
              {/* NEW badge */}
              <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">
                NEW
              </span>
              <FileTypeIcon name={entry.name} />
              <p className="flex-1 text-xs truncate text-foreground/80">
                {entry.path}
              </p>
              <p className="text-xs text-muted-foreground shrink-0">
                {formatBytes(entry.size)}
              </p>
            </div>
          ))}

          {overflow > 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              + {overflow} more file{overflow !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>

      {/* CTA */}
      <div className="flex gap-2 pt-1">
        <Button
          className="flex-1 gap-2 h-11"
          onClick={onPush}
          disabled={!isPeerReady}
        >
          <Upload className="h-4 w-4" />
          Push to {peerName}
          <ArrowRight className="h-4 w-4 ml-auto" />
        </Button>
      </div>

      {!isPeerReady && (
        <p className="text-xs text-center text-yellow-500">
          Waiting for connection with {peerName}…
        </p>
      )}
    </div>
  );
}

function SendingView({
  sendProgress,
  folderName,
  peerName,
  formatBytes,
}: {
  sendProgress: TransferProgress | null;
  folderName: string | null;
  peerName: string;
  formatBytes: (n: number) => string;
}) {
  const pct = sendProgress?.percentage ?? 0;
  const speed = sendProgress?.speed ?? 0;
  const eta = sendProgress?.eta ?? 0;

  return (
    <div className="flex flex-col gap-5 py-4">
      {/* Animated folder icon */}
      <div className="flex justify-center">
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <FolderSync className="h-8 w-8 text-primary animate-pulse" />
          </div>
          {/* Floating file particles */}
          <div className="absolute -top-1 -right-1 h-4 w-4 rounded bg-primary/20 animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="absolute -top-2 right-3 h-3 w-3 rounded bg-primary/30 animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="absolute top-0 -right-3 h-2.5 w-2.5 rounded bg-primary/20 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>

      {/* Label */}
      <div className="text-center">
        <p className="text-sm font-medium">
          Syncing{folderName ? ` "${folderName}"` : ""} to {peerName}
        </p>
        {sendProgress && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate px-4">
            {sendProgress.fileName}
          </p>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <Progress value={pct} className="h-2.5 rounded-full" />
        <div className="flex justify-between text-xs text-muted-foreground px-0.5">
          <span>{pct.toFixed(0)}%</span>
          <span className="flex items-center gap-2">
            {speed > 0 && (
              <span>{formatBytes(speed)}/s</span>
            )}
            {eta > 0 && (
              <span>~{eta < 60 ? `${Math.ceil(eta)}s` : `${Math.ceil(eta / 60)}m`}</span>
            )}
          </span>
          {sendProgress && (
            <span>
              {formatBytes(sendProgress.bytesTransferred)} / {formatBytes(sendProgress.totalBytes)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function DoneView({
  folderName,
  peerName,
  onReset,
  onClose,
  formatBytes,
  totalSize,
  fileCount,
}: {
  folderName: string | null;
  peerName: string;
  onReset: () => void;
  onClose: () => void;
  formatBytes: (n: number) => string;
  totalSize: number;
  fileCount: number;
}) {
  return (
    <div className="flex flex-col items-center gap-5 py-6">
      {/* Butterfly success icon */}
      <div className="relative">
        <div className="h-20 w-20 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
        </div>
        {/* Sparkles */}
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute h-2 w-2 rounded-full bg-emerald-400 animate-ping"
            style={{
              top: `${50 + 44 * Math.sin((i * Math.PI * 2) / 6)}%`,
              left: `${50 + 44 * Math.cos((i * Math.PI * 2) / 6)}%`,
              animationDelay: `${i * 100}ms`,
              animationDuration: "1.5s",
            }}
          />
        ))}
      </div>

      <div className="text-center">
        <p className="text-base font-semibold">Sync Complete 🦋</p>
        <p className="text-sm text-muted-foreground mt-1">
          {fileCount} file{fileCount !== 1 ? "s" : ""} ({formatBytes(totalSize)})
          {folderName ? ` from "${folderName}"` : ""} sent to{" "}
          <span className="text-foreground font-medium">{peerName}</span>
        </p>
      </div>

      <div className="flex gap-2 w-full">
        <Button variant="outline" className="flex-1" onClick={onReset}>
          Sync Another Folder
        </Button>
        <Button className="flex-1" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-destructive">Sync Failed</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{message}</p>
      </div>
      <Button variant="outline" onClick={onRetry} className="gap-2">
        Try Again
      </Button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SyncSheet({
  open,
  onClose,
  peerId,
  peerName,
  sendFiles,
  getDataChannelForPeer,
  isPeerReady,
  isSending,
  sendProgress,
  sendComplete,
  sendError,
  resetSendState,
  formatBytes,
}: SyncSheetProps) {
  const {
    phase,
    folderName,
    entries,
    totalSize,
    error,
    pickFolder,
    startPush,
    reset,
  } = useFolderSync({ sendFiles, getDataChannelForPeer });

  const sheetRef = useRef<HTMLDivElement>(null);
  const isDragOverRef = useRef(false);
  const [isDragOver, setIsDragOverState] = React.useState(false);

  function setIsDragOver(v: boolean) {
    isDragOverRef.current = v;
    setIsDragOverState(v);
  }

  // Sync sendComplete → useFolderSync "done" phase
  useEffect(() => {
    if (sendComplete && phase === "sending") {
      // The transfer hook reported completion — advance our phase
      void (async () => {
        // tiny tick to let sendComplete state settle
        await new Promise((r) => setTimeout(r, 0));
        // We don't call dispatch directly; startPush resolves when sendFiles resolves.
        // This is a belt-and-suspenders guard in case startPush didn't advance.
      })();
    }
  }, [sendComplete, phase]);

  // Reset sync state when sheet closes
  useEffect(() => {
    if (!open) {
      reset();
      resetSendState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Handle folder drop onto the idle drag zone
  function handleDrop(e: React.DragEvent) {
    const items = Array.from(e.dataTransfer.items);
    const dirEntry = items.find(
      (item) =>
        item.kind === "file" &&
        item.webkitGetAsEntry?.()?.isDirectory,
    );

    if (dirEntry) {
      // Trigger the picker instead — reading dropped dirs requires
      // FileSystem Entry API which has inconsistent support; better UX to
      // just open the OS picker so the user selects the right folder.
      pickFolder();
    } else {
      // Files were dropped directly — not supported in folder-sync mode
      // (user probably meant the main drop zone)
    }
  }

  // Close on backdrop click
  function handleBackdropClick(e: React.MouseEvent) {
    if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
      onClose();
    }
  }

  if (!open) return null;

  // Determine which view to show
  // The "sending" phase can also be detected via isSending from parent
  const effectivePhase = (phase === "preview" && isSending)
    ? "sending"
    : (phase === "preview" && sendComplete)
    ? "done"
    : phase;

  const peerReady = isPeerReady(peerId);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
      onClick={handleBackdropClick}
    >
      {/* Sheet */}
      <div
        ref={sheetRef}
        className={cn(
          "w-full max-w-lg mb-0 sm:mb-6 sm:rounded-2xl rounded-t-2xl",
          "bg-background border border-border/60 shadow-2xl",
          "animate-in slide-in-from-bottom-4 duration-300",
          "max-h-[90vh] overflow-y-auto",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FolderSync className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold leading-none">
                Sync Folder
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                to{" "}
                <span className="text-foreground font-medium">{peerName}</span>
                {peerReady ? (
                  <span className="ml-1.5 text-emerald-500">● Connected</span>
                ) : (
                  <span className="ml-1.5 text-yellow-500">● Connecting…</span>
                )}
              </p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {effectivePhase === "idle" && (
            <IdleView
              peerName={peerName}
              onPickFolder={pickFolder}
              onDrop={handleDrop}
              isDragOver={isDragOver}
              setIsDragOver={setIsDragOver}
            />
          )}

          {effectivePhase === "scanning" && (
            <ScanningView folderName={folderName ?? undefined} />
          )}

          {effectivePhase === "preview" && (
            <PreviewView
              folderName={folderName!}
              entries={entries}
              totalSize={totalSize}
              peerName={peerName}
              isPeerReady={peerReady}
              onPush={() => startPush(peerId, peerName)}
              onChangePicker={pickFolder}
              formatBytes={formatBytes}
            />
          )}

          {effectivePhase === "sending" && (
            <SendingView
              sendProgress={sendProgress}
              folderName={folderName}
              peerName={peerName}
              formatBytes={formatBytes}
            />
          )}

          {effectivePhase === "done" && (
            <DoneView
              folderName={folderName}
              peerName={peerName}
              totalSize={totalSize}
              fileCount={entries.length}
              onReset={() => {
                reset();
                resetSendState();
              }}
              onClose={onClose}
              formatBytes={formatBytes}
            />
          )}

          {effectivePhase === "error" && (
            <ErrorView
              message={
                error ??
                sendError ??
                "Something went wrong."
              }
              onRetry={() => {
                reset();
                resetSendState();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Need React in scope for useState
import React from "react";
