/**
 * BDP — Sync Dashboard (Phase F1)
 *
 * Top-level UI for the BDP sync feature. Shows all configured sync pairs as
 * cards, with real-time status badges derived from BDPEngineState, last-synced
 * timestamps, transfer stats, and per-pair actions (Sync Now, Browse Files,
 * Delete).
 *
 * Status badge logic:
 *   idle  + lastSyncedAt < 5 min ago  → green  "Synced"
 *   idle  + roots differ or never     → yellow "Pending"
 *   greeting / diffing / *_sync       → blue   "Connecting…"
 *   transferring / finalizing         → blue   "Syncing…"
 *   resolving_conflict                → orange "Conflict"
 *   retrying                          → yellow "Retrying…"
 *   error                             → red    "Error"
 *   no peer online (no engine state)  → grey   "Offline"
 */

import { useMemo } from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  HardDrive,
  RefreshCw,
  Folder,
  Trash2,
  Plus,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import type {
  BDPEngineState,
  BDPEnginePhase,
  PairId,
  SyncPair,
} from "@/types/bdp";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncDashboardProps {
  pairs: SyncPair[];
  engineStates: Map<PairId, BDPEngineState>;
  onAddPair(): void;
  onViewVault(pairId: PairId): void;
  onDeletePair(pairId: PairId): void;
  onSyncNow(pairId: PairId): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────────────────────

type StatusKind =
  | "synced"
  | "pending"
  | "connecting"
  | "syncing"
  | "conflict"
  | "retrying"
  | "error"
  | "offline";

interface PairStatus {
  kind: StatusKind;
  label: string;
  /** 0–100, only meaningful when kind === 'syncing' */
  progress: number;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function getPairStatus(
  pair: SyncPair,
  state: BDPEngineState | undefined,
): PairStatus {
  if (!state) {
    return { kind: "offline", label: "Offline", progress: 0 };
  }

  const phase: BDPEnginePhase = state.phase;

  switch (phase) {
    case "greeting":
      return { kind: "connecting", label: "Connecting…", progress: 0 };

    case "diffing":
    case "delta_sync":
    case "full_sync":
      return { kind: "syncing", label: "Comparing…", progress: 0 };

    case "transferring": {
      const plan = state.syncPlan;
      const total = [...(plan?.upload ?? []), ...(plan?.download ?? [])].reduce(
        (sum, e) => sum + e.size,
        0,
      );
      const done =
        state.sessionStats.bytesUploaded + state.sessionStats.bytesDownloaded;
      const progress = total > 0 ? Math.min(100, (done / total) * 100) : 0;
      return { kind: "syncing", label: "Syncing…", progress };
    }

    case "finalizing":
      return { kind: "syncing", label: "Finalising…", progress: 95 };

    case "resolving_conflict":
      return { kind: "conflict", label: "Conflict", progress: 0 };

    case "retrying":
      return { kind: "retrying", label: "Retrying…", progress: 0 };

    case "error":
      return { kind: "error", label: "Error", progress: 0 };

    case "idle":
    default: {
      const recentSync =
        pair.lastSyncedAt !== null &&
        Date.now() - pair.lastSyncedAt < FIVE_MINUTES_MS;

      if (recentSync) {
        return { kind: "synced", label: "Synced", progress: 100 };
      }
      return { kind: "pending", label: "Pending", progress: 0 };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge styles
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  StatusKind,
  { badge: string; icon: React.ReactNode }
> = {
  synced: {
    badge:
      "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
    icon: <CheckCircle2 className="size-3" />,
  },
  pending: {
    badge:
      "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
    icon: <Clock className="size-3" />,
  },
  connecting: {
    badge:
      "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800",
    icon: <Wifi className="size-3 animate-pulse" />,
  },
  syncing: {
    badge:
      "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
    icon: <RefreshCw className="size-3 animate-spin" />,
  },
  conflict: {
    badge:
      "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
    icon: <AlertTriangle className="size-3" />,
  },
  retrying: {
    badge:
      "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
    icon: <RefreshCw className="size-3 animate-spin" />,
  },
  error: {
    badge:
      "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
    icon: <AlertTriangle className="size-3" />,
  },
  offline: {
    badge:
      "bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800/40 dark:text-zinc-400 dark:border-zinc-700",
    icon: <WifiOff className="size-3" />,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function formatRelativeTime(ts: number | null): string {
  if (ts === null) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Direction icon helper
// ─────────────────────────────────────────────────────────────────────────────

function DirectionIcon({ direction }: { direction: SyncPair["direction"] }) {
  if (direction === "upload-only") {
    return <ArrowUp className="size-3" />;
  }
  if (direction === "download-only") {
    return <ArrowDown className="size-3" />;
  }
  return <ArrowUpDown className="size-3" />;
}

function directionLabel(direction: SyncPair["direction"]): string {
  if (direction === "upload-only") return "Upload only";
  if (direction === "download-only") return "Download only";
  return "Bidirectional";
}

// ─────────────────────────────────────────────────────────────────────────────
// PairCard
// ─────────────────────────────────────────────────────────────────────────────

interface PairCardProps {
  pair: SyncPair;
  state: BDPEngineState | undefined;
  onViewVault(): void;
  onDeletePair(): void;
  onSyncNow(): void;
}

function PairCard({
  pair,
  state,
  onViewVault,
  onDeletePair,
  onSyncNow,
}: PairCardProps) {
  const status = useMemo(() => getPairStatus(pair, state), [pair, state]);
  const styles = STATUS_STYLES[status.kind];

  // The "other" device in the pair (not this device)
  const peerDevice = pair.devices.find(
    (d) => d.deviceId !== pair.devices[0]?.deviceId,
  );

  const sessionBytes =
    (state?.sessionStats.bytesUploaded ?? 0) +
    (state?.sessionStats.bytesDownloaded ?? 0);

  const isBusy = status.kind === "syncing" || status.kind === "connecting";

  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md w-full">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          {/* Folder info */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="shrink-0 flex items-center justify-center size-9 rounded-lg bg-primary/10 text-primary">
              <Folder className="size-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold truncate leading-tight">
                {pair.localFolder.name}
              </CardTitle>
              <CardDescription className="text-xs truncate mt-0.5">
                {peerDevice ? (
                  <span className="flex items-center gap-1">
                    <HardDrive className="size-3 shrink-0" />
                    <span className="truncate">{peerDevice.deviceName}</span>
                  </span>
                ) : (
                  <span className="italic text-muted-foreground/70">
                    Waiting for peer…
                  </span>
                )}
              </CardDescription>
            </div>
          </div>

          {/* Status badge */}
          <Badge
            className={cn(
              "shrink-0 flex items-center gap-1 text-[11px] px-2 py-0.5 border whitespace-nowrap",
              styles.badge,
            )}
          >
            {styles.icon}
            {status.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pb-2 space-y-2">
        {/* Progress bar — shown while syncing */}
        {isBusy && status.progress > 0 && (
          <Progress value={status.progress} className="h-1.5" />
        )}

        {/* Stats row */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground gap-2 flex-wrap">
          <span>Last sync: {formatRelativeTime(pair.lastSyncedAt)}</span>
          {sessionBytes > 0 && (
            <span className="flex items-center gap-0.5 shrink-0">
              <ArrowUpDown className="size-3" />
              {formatBytes(sessionBytes)}
            </span>
          )}
        </div>

        {/* Error message */}
        {status.kind === "error" && state?.error && (
          <p className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1 wrap-break-word">
            {state.error.message}
          </p>
        )}

        {/* Conflict count */}
        {status.kind === "conflict" && (
          <p className="text-[11px] text-orange-600 dark:text-orange-400">
            {state?.pendingConflicts.length ?? 0} conflict
            {(state?.pendingConflicts.length ?? 0) !== 1 ? "s" : ""} need
            resolution
          </p>
        )}

        {/* Offline hint */}
        {status.kind === "offline" && (
          <p className="text-[11px] text-muted-foreground/70 bg-muted/40 rounded px-2 py-1">
            Open Butterfly Drop on the other device (same session or scan the
            QR again), go to the Sync tab, and stay on it. Switch back here to
            retry.
          </p>
        )}

        {/* Connecting hint — greeting can take a few seconds */}
        {status.kind === "connecting" && (
          <p className="text-[11px] text-muted-foreground/70 bg-muted/40 rounded px-2 py-1">
            Establishing secure connection… Ensure the other device has the app
            open and is on the Sync tab.
          </p>
        )}

        {/* Direction badge */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border bg-muted/40">
            <DirectionIcon direction={pair.direction} />
            {directionLabel(pair.direction)}
          </span>
          {pair.localFolder.useRealFS && (
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border bg-muted/40">
              Real FS
            </span>
          )}
        </div>
      </CardContent>

      <CardFooter className="pt-2 gap-2 mt-auto flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-8 min-w-20"
          onClick={onSyncNow}
          disabled={isBusy || status.kind === "offline"}
          title={
            status.kind === "offline"
              ? "No peer connected"
              : "Trigger a manual sync"
          }
        >
          <RefreshCw className="size-3.5 mr-1" />
          Sync Now
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-8 min-w-20"
          onClick={onViewVault}
        >
          <Folder className="size-3.5 mr-1" />
          Files
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8 shrink-0"
          onClick={onDeletePair}
          title="Delete this sync pair"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ onAddPair }: { onAddPair(): void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="flex items-center justify-center size-14 rounded-2xl bg-primary/10 text-primary mb-4">
        <ArrowUpDown className="size-7" />
      </div>
      <h3 className="text-sm font-semibold mb-1">No sync pairs yet</h3>
      <p className="text-xs text-muted-foreground max-w-55 mb-5 leading-relaxed">
        Create a sync pair to share folders directly between your devices —
        peer-to-peer, end-to-end encrypted, no cloud required.
      </p>
      <Button onClick={onAddPair} size="sm" className="gap-2">
        <Plus className="size-4" />
        Add Sync Pair
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SyncDashboard
// ─────────────────────────────────────────────────────────────────────────────

export function SyncDashboard({
  pairs,
  engineStates,
  onAddPair,
  onViewVault,
  onDeletePair,
  onSyncNow,
}: SyncDashboardProps) {
  const totalSyncing = useMemo(
    () =>
      [...engineStates.values()].filter(
        (s) =>
          s.phase === "transferring" ||
          s.phase === "diffing" ||
          s.phase === "full_sync" ||
          s.phase === "delta_sync",
      ).length,
    [engineStates],
  );

  const totalConflicts = useMemo(
    () =>
      [...engineStates.values()].filter((s) => s.phase === "resolving_conflict")
        .length,
    [engineStates],
  );

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Sync Pairs</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pairs.length === 0
              ? "No pairs configured"
              : `${pairs.length} pair${pairs.length !== 1 ? "s" : ""}${
                  totalSyncing > 0 ? ` · ${totalSyncing} syncing` : ""
                }${
                  totalConflicts > 0
                    ? ` · ${totalConflicts} conflict${
                        totalConflicts !== 1 ? "s" : ""
                      }`
                    : ""
                }`}
          </p>
        </div>

        {pairs.length > 0 && (
          <Button size="sm" onClick={onAddPair} className="gap-1.5 h-8 text-xs">
            <Plus className="size-3.5" />
            Add Pair
          </Button>
        )}
      </div>

      {/* Content — single-column grid to fit inside the narrow side panel */}
      {pairs.length === 0 ? (
        <EmptyState onAddPair={onAddPair} />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {pairs.map((pair) => (
            <PairCard
              key={pair.pairId}
              pair={pair}
              state={engineStates.get(pair.pairId)}
              onViewVault={() => onViewVault(pair.pairId)}
              onDeletePair={() => onDeletePair(pair.pairId)}
              onSyncNow={() => onSyncNow(pair.pairId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
