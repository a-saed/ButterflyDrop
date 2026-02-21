/**
 * BDP — Sync Progress (Phase F5)
 *
 * Real-time progress panel rendered while a BDPSession is in the
 * `transferring` phase. Displays:
 *
 *   - Overall progress bar (bytes transferred / total bytes)
 *   - Per-file rows with individual progress bars and direction icons
 *   - Transfer speed in human-readable units (KB/s, MB/s)
 *   - ETA formatted as "Xs" / "Xm Xs"
 *   - Bytes saved through deduplication and compression
 *   - Session stats summary once the phase moves to idle/finalizing
 *
 * This component is purely presentational — it reads from BDPEngineState
 * and BDPSyncStats which are already maintained by BDPSession and
 * surfaced through the useBDP hook.
 *
 * Dependencies: shadcn/ui, lucide-react, src/types/bdp.ts
 */

import { useMemo } from "react";
import {
  ArrowUp,
  ArrowDown,
  Zap,
  Clock,
  Layers,
  PackageCheck,
  CheckCircle2,
  Loader2,
  FileStack,
} from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type {
  BDPEngineState,
  BDPEnginePhase,
  BDPSyncStats,
  BDPTransferState,
  TransferId,
} from "@/types/bdp";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncProgressProps {
  state: BDPEngineState;
  /** Optional extra class applied to the root element */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_024 * 1_024 * 1_024)
    return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
  return `${(bytes / (1_024 * 1_024 * 1_024)).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return "—";
  if (bytesPerSecond < 1_024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1_024 * 1_024)
    return `${(bytesPerSecond / 1_024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1_024 * 1_024)).toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase label
// ─────────────────────────────────────────────────────────────────────────────

function phaseLabel(phase: BDPEnginePhase): string {
  switch (phase) {
    case "greeting":
      return "Connecting…";
    case "diffing":
      return "Comparing file trees…";
    case "delta_sync":
      return "Fetching changes…";
    case "full_sync":
      return "Fetching full index…";
    case "transferring":
      return "Transferring files…";
    case "finalizing":
      return "Finalising sync…";
    case "resolving_conflict":
      return "Waiting for conflict resolution…";
    case "retrying":
      return "Retrying…";
    case "error":
      return "Error";
    case "idle":
      return "Idle";
    default:
      return "Syncing…";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Overall progress calculation
// ─────────────────────────────────────────────────────────────────────────────

interface OverallProgress {
  /** 0–100 */
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  /** Weighted average speed across active transfers, bytes/s */
  speed: number;
  /** Max ETA across active transfers, seconds */
  eta: number;
}

function computeOverall(
  activeTransfers: Record<TransferId, BDPTransferState>,
  stats: BDPSyncStats,
  plan: BDPEngineState["syncPlan"],
): OverallProgress {
  const transfers = Object.values(activeTransfers);

  // Total bytes = plan total (upload + download)
  const planTotal = plan
    ? [...(plan.upload ?? []), ...(plan.download ?? [])].reduce(
        (sum, e) => sum + e.size,
        0,
      )
    : 0;

  const transferredBytes = stats.bytesUploaded + stats.bytesDownloaded;

  // In-flight bytes from active transfers (not yet counted in stats)
  const inFlightTransferred = transfers.reduce(
    (sum, t) => sum + t.transferredBytes,
    0,
  );

  const totalTransferred = transferredBytes + inFlightTransferred;
  const totalBytes = Math.max(planTotal, totalTransferred, 1);

  const percent = Math.min(100, (totalTransferred / totalBytes) * 100);

  // Aggregate speed = sum of individual speeds
  const speed = transfers.reduce((sum, t) => sum + t.speed, 0);

  // ETA = max remaining / speed across active transfers
  const remaining = totalBytes - totalTransferred;
  const eta = speed > 0 ? remaining / speed : 0;

  return {
    percent,
    transferredBytes: totalTransferred,
    totalBytes,
    speed,
    eta,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-file row
// ─────────────────────────────────────────────────────────────────────────────

interface TransferRowProps {
  transfer: BDPTransferState;
}

function TransferRow({ transfer }: TransferRowProps) {
  const isUpload = transfer.direction === "upload";
  const percent =
    transfer.totalChunks > 0
      ? Math.min(100, (transfer.completedChunks / transfer.totalChunks) * 100)
      : 0;

  const name = basename(transfer.path);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {/* Direction icon */}
        <div
          className={cn(
            "flex items-center justify-center size-5 rounded shrink-0",
            isUpload
              ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
              : "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
          )}
          title={isUpload ? "Uploading" : "Downloading"}
        >
          {isUpload ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )}
        </div>

        {/* File name */}
        <span
          className="flex-1 text-xs font-medium truncate"
          title={transfer.path}
        >
          {name}
        </span>

        {/* Chunk counter */}
        <span className="text-[10px] text-muted-foreground shrink-0">
          {transfer.completedChunks}/{transfer.totalChunks}
        </span>

        {/* Speed */}
        {transfer.speed > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0 w-13 text-right">
            {formatSpeed(transfer.speed)}
          </span>
        )}

        {/* ETA */}
        {transfer.eta > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0 w-10 text-right">
            {formatEta(transfer.eta)}
          </span>
        )}
      </div>

      {/* Per-file progress bar */}
      <div className="pl-7">
        <Progress
          value={percent}
          className={cn(
            "h-1",
            isUpload ? "[&>div]:bg-blue-500" : "[&>div]:bg-violet-500",
          )}
        />
        <div className="flex justify-between mt-0.5">
          <span className="text-[9px] text-muted-foreground">
            {formatBytes(transfer.transferredBytes)}
          </span>
          <span className="text-[9px] text-muted-foreground">
            {formatBytes(transfer.totalBytes)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats summary (shown after sync completes)
// ─────────────────────────────────────────────────────────────────────────────

interface StatsSummaryProps {
  stats: BDPSyncStats;
}

function StatsSummary({ stats }: StatsSummaryProps) {
  const rows: Array<{ icon: React.ReactNode; label: string; value: string }> =
    [];

  if (stats.filesUploaded > 0) {
    rows.push({
      icon: <ArrowUp className="size-3 text-blue-500" />,
      label: "Uploaded",
      value: `${stats.filesUploaded} file${stats.filesUploaded !== 1 ? "s" : ""} (${formatBytes(stats.bytesUploaded)})`,
    });
  }

  if (stats.filesDownloaded > 0) {
    rows.push({
      icon: <ArrowDown className="size-3 text-violet-500" />,
      label: "Downloaded",
      value: `${stats.filesDownloaded} file${stats.filesDownloaded !== 1 ? "s" : ""} (${formatBytes(stats.bytesDownloaded)})`,
    });
  }

  if (stats.filesSkipped > 0) {
    rows.push({
      icon: <PackageCheck className="size-3 text-emerald-500" />,
      label: "Unchanged",
      value: `${stats.filesSkipped} file${stats.filesSkipped !== 1 ? "s" : ""}`,
    });
  }

  if (stats.bytesSavedDedup > 0) {
    rows.push({
      icon: <Layers className="size-3 text-amber-500" />,
      label: "Saved (dedup)",
      value: formatBytes(stats.bytesSavedDedup),
    });
  }

  if (stats.bytesSavedCompression > 0) {
    rows.push({
      icon: <Zap className="size-3 text-amber-500" />,
      label: "Saved (compression)",
      value: formatBytes(stats.bytesSavedCompression),
    });
  }

  if (stats.durationMs > 0) {
    rows.push({
      icon: <Clock className="size-3 text-muted-foreground" />,
      label: "Duration",
      value: formatDuration(stats.durationMs),
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="shrink-0">{row.icon}</span>
          <span className="text-[11px] text-muted-foreground flex-1">
            {row.label}
          </span>
          <span className="text-[11px] font-medium">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase-specific inline summaries (non-transfer phases)
// ─────────────────────────────────────────────────────────────────────────────

function PhaseSummary({ state }: { state: BDPEngineState }) {
  const plan = state.syncPlan;

  if (state.phase === "idle" && !plan) return null;

  if (
    state.phase === "diffing" ||
    state.phase === "delta_sync" ||
    state.phase === "full_sync"
  ) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin shrink-0" />
        <span>Analysing differences…</span>
      </div>
    );
  }

  if (state.phase === "finalizing") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin shrink-0" />
        <span>Updating Merkle index and pushing relay delta…</span>
      </div>
    );
  }

  if (plan && state.phase === "transferring") {
    const uploadCount = plan.upload.length;
    const downloadCount = plan.download.length;
    const conflictCount = plan.conflicts.length;

    return (
      <div className="flex flex-wrap gap-1.5">
        {uploadCount > 0 && (
          <Badge className="text-[10px] px-1.5 py-0.5 gap-1 bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800">
            <ArrowUp className="size-2.5" />
            {uploadCount} upload{uploadCount !== 1 ? "s" : ""}
          </Badge>
        )}
        {downloadCount > 0 && (
          <Badge className="text-[10px] px-1.5 py-0.5 gap-1 bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800">
            <ArrowDown className="size-2.5" />
            {downloadCount} download{downloadCount !== 1 ? "s" : ""}
          </Badge>
        )}
        {conflictCount > 0 && (
          <Badge className="text-[10px] px-1.5 py-0.5 gap-1 bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800">
            {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}
          </Badge>
        )}
        {plan.unchangedCount > 0 && (
          <Badge className="text-[10px] px-1.5 py-0.5 gap-1 bg-muted text-muted-foreground border-border">
            <PackageCheck className="size-2.5" />
            {plan.unchangedCount} unchanged
          </Badge>
        )}
      </div>
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SyncProgress
// ─────────────────────────────────────────────────────────────────────────────

export function SyncProgress({ state, className }: SyncProgressProps) {
  const activeTransfers = useMemo(
    () => Object.values(state.activeTransfers),
    [state.activeTransfers],
  );

  const overall = useMemo(
    () =>
      computeOverall(state.activeTransfers, state.sessionStats, state.syncPlan),
    [state.activeTransfers, state.sessionStats, state.syncPlan],
  );

  const isActive =
    state.phase === "transferring" ||
    state.phase === "diffing" ||
    state.phase === "delta_sync" ||
    state.phase === "full_sync" ||
    state.phase === "finalizing" ||
    state.phase === "greeting";

  const isDone = state.phase === "idle" && state.sessionStats.durationMs > 0;
  const isError = state.phase === "error";

  // Nothing to show when truly idle with no history
  if (
    state.phase === "idle" &&
    state.sessionStats.durationMs === 0 &&
    activeTransfers.length === 0
  ) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-3 w-full", className)}>
      {/* Phase header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isDone ? (
            <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
          ) : isError ? (
            <FileStack className="size-4 text-red-500 shrink-0" />
          ) : (
            <Loader2 className="size-4 animate-spin text-primary shrink-0" />
          )}
          <span className="text-sm font-medium truncate">
            {isDone ? "Sync complete" : phaseLabel(state.phase)}
          </span>
        </div>

        {/* Peer name */}
        {state.peerDeviceName && (
          <span className="text-[11px] text-muted-foreground shrink-0">
            ↔ {state.peerDeviceName}
          </span>
        )}
      </div>

      {/* Overall progress bar — shown while transferring */}
      {isActive && state.phase === "transferring" && (
        <div className="space-y-1.5">
          <Progress value={overall.percent} className="h-2" />

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {formatBytes(overall.transferredBytes)} /{" "}
              {formatBytes(overall.totalBytes)}
            </span>

            <div className="flex items-center gap-3">
              {overall.speed > 0 && (
                <span className="flex items-center gap-1">
                  <Zap className="size-3" />
                  {formatSpeed(overall.speed)}
                </span>
              )}
              {overall.eta > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatEta(overall.eta)}
                </span>
              )}
              <span className="font-medium text-foreground">
                {Math.round(overall.percent)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Indeterminate progress for non-transfer active phases */}
      {isActive && state.phase !== "transferring" && (
        <Progress value={undefined} className="h-1.5 [&>div]:animate-pulse" />
      )}

      {/* Plan summary badges */}
      <PhaseSummary state={state} />

      {/* Active per-file transfer rows */}
      {activeTransfers.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Active transfers ({activeTransfers.length})
          </p>
          {activeTransfers.map((transfer) => (
            <TransferRow key={transfer.transferId} transfer={transfer} />
          ))}
        </div>
      )}

      {/* Dedup / compression savings — shown while transferring */}
      {state.phase === "transferring" &&
        (state.sessionStats.bytesSavedDedup > 0 ||
          state.sessionStats.bytesSavedCompression > 0) && (
          <div className="flex flex-wrap gap-2">
            {state.sessionStats.bytesSavedDedup > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                <Layers className="size-3" />
                {formatBytes(state.sessionStats.bytesSavedDedup)} saved (dedup)
              </span>
            )}
            {state.sessionStats.bytesSavedCompression > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                <Zap className="size-3" />
                {formatBytes(state.sessionStats.bytesSavedCompression)} saved
                (compression)
              </span>
            )}
          </div>
        )}

      {/* Stats summary — shown after sync completes */}
      {isDone && <StatsSummary stats={state.sessionStats} />}

      {/* Error details */}
      {isError && state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10 px-3 py-2.5">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400">
            {state.error.message}
          </p>
          {state.error.recoverable && (
            <p className="text-[11px] text-red-500 dark:text-red-500 mt-0.5">
              Retrying automatically… (attempt {state.retryCount})
            </p>
          )}
        </div>
      )}
    </div>
  );
}
