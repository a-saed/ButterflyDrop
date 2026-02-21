/**
 * BDP — Conflict Resolver (Phase F4)
 *
 * Side-by-side conflict resolution UI. Shown when a BDPSession enters the
 * `resolving_conflict` phase. Presents each pending BDPConflict with:
 *
 *   Left panel  — local file  (name, size, mtime, vector clock, text preview)
 *   Right panel — remote file (same)
 *
 * Three resolution actions per conflict:
 *   "Keep Mine"   → keep-local  (discard remote version)
 *   "Keep Theirs" → keep-remote (discard local version, accept remote)
 *   "Keep Both"   → keep-both   (rename loser to filename.{deviceName}.conflict)
 *
 * Once all conflicts in the list are resolved the component calls onAllResolved().
 *
 * Dependencies: shadcn/ui, lucide-react, src/types/bdp.ts
 */

import { useState, useCallback, useMemo } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  HardDrive,
  Layers,
  MonitorSmartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import type {
  BDPConflict,
  BDPFileEntry,
  ConflictResolution,
  PairId,
  VectorClock,
} from "@/types/bdp";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ConflictResolverProps {
  pairId: PairId;
  conflicts: BDPConflict[];
  /** Human-readable name for the local device */
  localDeviceName: string;
  /** Human-readable name for the remote peer device */
  remoteDeviceName: string;
  /** Called for each individual conflict resolution */
  onResolve(
    pairId: PairId,
    path: string,
    resolution: ConflictResolution,
  ): Promise<void>;
  /** Called after the last conflict has been resolved */
  onAllResolved(): void;
  /** Called if the user wants to dismiss/defer (leaves conflicts unresolved) */
  onDismiss(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatVectorClock(vc: VectorClock): string {
  const entries = Object.entries(vc);
  if (entries.length === 0) return "{}";
  return entries.map(([k, v]) => `${k.slice(0, 6)}…:${v}`).join(", ");
}

// ─────────────────────────────────────────────────────────────────────────────
// File summary panel
// ─────────────────────────────────────────────────────────────────────────────

type PanelSide = "local" | "remote";

interface FilePanelProps {
  entry: BDPFileEntry;
  side: PanelSide;
  deviceName: string;
  highlighted: boolean;
  onSelect(): void;
}

function FilePanel({
  entry,
  side,
  deviceName,
  highlighted,
  onSelect,
}: FilePanelProps) {
  const isLocal = side === "local";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex flex-col gap-3 rounded-xl border-2 p-4 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        highlighted
          ? isLocal
            ? "border-blue-400 bg-blue-50/50 dark:bg-blue-900/10"
            : "border-violet-400 bg-violet-50/50 dark:bg-violet-900/10"
          : "border-border hover:border-muted-foreground/40 bg-card",
      )}
    >
      {/* Device label */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex items-center justify-center size-7 rounded-md shrink-0",
            isLocal
              ? "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
              : "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400",
          )}
        >
          {isLocal ? (
            <MonitorSmartphone className="size-3.5" />
          ) : (
            <HardDrive className="size-3.5" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate">{deviceName}</p>
          <p
            className={cn(
              "text-[10px]",
              isLocal ? "text-blue-500 dark:text-blue-400" : "text-violet-500 dark:text-violet-400",
            )}
          >
            {isLocal ? "Your version" : "Their version"}
          </p>
        </div>

        {highlighted && (
          <Badge
            className={cn(
              "ml-auto text-[10px] px-1.5 py-0.5 shrink-0",
              isLocal
                ? "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-400 dark:border-blue-800"
                : "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/40 dark:text-violet-400 dark:border-violet-800",
            )}
          >
            Selected
          </Badge>
        )}
      </div>

      {/* Metadata table */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">Size</span>
        <span className="font-medium">{formatBytes(entry.size)}</span>

        <span className="text-muted-foreground">Modified</span>
        <span className="font-medium truncate" title={formatDate(entry.mtime)}>
          {formatRelativeTime(entry.mtime)}
        </span>

        <span className="text-muted-foreground">Full date</span>
        <span className="text-muted-foreground truncate">
          {formatDate(entry.mtime)}
        </span>

        <span className="text-muted-foreground">Seq</span>
        <span className="font-mono">{entry.seq}</span>

        <span className="text-muted-foreground">Vector</span>
        <span
          className="font-mono truncate text-[10px]"
          title={formatVectorClock(entry.vectorClock)}
        >
          {formatVectorClock(entry.vectorClock)}
        </span>

        {entry.tombstone && (
          <>
            <span className="text-muted-foreground">State</span>
            <span className="text-red-500 dark:text-red-400 font-medium">
              Deleted
            </span>
          </>
        )}
      </div>

      {/* Hash preview */}
      <div className="flex items-center gap-1.5">
        <Copy className="size-3 text-muted-foreground shrink-0" />
        <span
          className="font-mono text-[10px] text-muted-foreground truncate"
          title={entry.hash}
        >
          {entry.hash.slice(0, 16)}…
        </span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution button row
// ─────────────────────────────────────────────────────────────────────────────

interface ResolutionButtonsProps {
  selection: PanelSide | null;
  resolving: boolean;
  onKeepLocal(): void;
  onKeepRemote(): void;
  onKeepBoth(): void;
}

function ResolutionButtons({
  selection,
  resolving,
  onKeepLocal,
  onKeepRemote,
  onKeepBoth,
}: ResolutionButtonsProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant={selection === "local" ? "default" : "outline"}
          size="sm"
          onClick={onKeepLocal}
          disabled={resolving}
          className={cn(
            "gap-1.5 text-xs h-9 flex-col py-1.5",
            selection === "local" &&
              "bg-blue-600 hover:bg-blue-700 text-white border-blue-600",
          )}
        >
          <ArrowLeft className="size-3.5" />
          Keep Mine
        </Button>

        <Button
          variant={selection === null ? "outline" : "outline"}
          size="sm"
          onClick={onKeepBoth}
          disabled={resolving}
          className="gap-1.5 text-xs h-9 flex-col py-1.5"
        >
          <Layers className="size-3.5" />
          Keep Both
        </Button>

        <Button
          variant={selection === "remote" ? "default" : "outline"}
          size="sm"
          onClick={onKeepRemote}
          disabled={resolving}
          className={cn(
            "gap-1.5 text-xs h-9 flex-col py-1.5",
            selection === "remote" &&
              "bg-violet-600 hover:bg-violet-700 text-white border-violet-600",
          )}
        >
          <ArrowRight className="size-3.5" />
          Keep Theirs
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        {selection === "local"
          ? "Your version will be kept. Their version will be discarded."
          : selection === "remote"
            ? "Their version will be accepted. Your version will be discarded."
            : '"Keep Both" renames the older version to filename.conflict'}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Single conflict view
// ─────────────────────────────────────────────────────────────────────────────

interface ConflictViewProps {
  conflict: BDPConflict;
  index: number;
  total: number;
  localDeviceName: string;
  remoteDeviceName: string;
  onResolve(resolution: ConflictResolution): Promise<void>;
  onNext(): void;
}

function ConflictView({
  conflict,
  index,
  total,
  localDeviceName,
  remoteDeviceName,
  onResolve,
  onNext,
}: ConflictViewProps) {
  const [selection, setSelection] = useState<PanelSide | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-highlight the newer file as a suggestion
  const suggestion = useMemo<PanelSide>(() => {
    return conflict.local.mtime >= conflict.remote.mtime ? "local" : "remote";
  }, [conflict]);

  const handleKeepLocal = useCallback(() => {
    setSelection("local");
  }, []);

  const handleKeepRemote = useCallback(() => {
    setSelection("remote");
  }, []);

  const handleKeepBoth = useCallback(async () => {
    setResolving(true);
    setError(null);
    try {
      await onResolve("keep-both");
      setResolved(true);
      setTimeout(onNext, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  }, [onResolve, onNext]);

  const handleConfirm = useCallback(async () => {
    if (!selection) return;
    const resolution: ConflictResolution =
      selection === "local" ? "keep-local" : "keep-remote";

    setResolving(true);
    setError(null);
    try {
      await onResolve(resolution);
      setResolved(true);
      setTimeout(onNext, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  }, [selection, onResolve, onNext]);

  // ── Resolved state ────────────────────────────────────────────────────────

  if (resolved) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <CheckCircle2 className="size-10 text-emerald-500" />
        <p className="text-sm font-medium">Conflict resolved</p>
      </div>
    );
  }

  // ── Conflict view ─────────────────────────────────────────────────────────

  const filename = conflict.path.split("/").pop() ?? conflict.path;

  return (
    <div className="flex flex-col gap-4">
      {/* Conflict header */}
      <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900/50 dark:bg-orange-900/10 px-3 py-2.5">
        <AlertTriangle className="size-4 text-orange-500 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-orange-800 dark:text-orange-300 truncate">
            {filename}
          </p>
          <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-0.5 truncate">
            {conflict.path}
          </p>
        </div>

        {/* Suggestion badge */}
        <Badge
          className={cn(
            "ml-auto shrink-0 text-[10px] px-1.5 border",
            "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
          )}
        >
          <Clock className="size-2.5 mr-0.5" />
          {suggestion === "local" ? "Yours is newer" : "Theirs is newer"}
        </Badge>
      </div>

      {/* Auto-resolution hint */}
      {conflict.autoResolution !== "none" && (
        <p className="text-[11px] text-muted-foreground text-center">
          Auto-suggested:{" "}
          <span className="font-medium">
            {conflict.autoResolution === "keep-local"
              ? "Keep yours"
              : conflict.autoResolution === "keep-remote"
                ? "Keep theirs"
                : "Keep both"}
          </span>{" "}
          — override below if needed
        </p>
      )}

      {/* Side-by-side panels */}
      <div className="grid grid-cols-2 gap-2">
        <FilePanel
          entry={conflict.local}
          side="local"
          deviceName={localDeviceName}
          highlighted={selection === "local"}
          onSelect={handleKeepLocal}
        />
        <FilePanel
          entry={conflict.remote}
          side="remote"
          deviceName={remoteDeviceName}
          highlighted={selection === "remote"}
          onSelect={handleKeepRemote}
        />
      </div>

      {/* Resolution buttons */}
      <ResolutionButtons
        selection={selection}
        resolving={resolving}
        onKeepLocal={handleKeepLocal}
        onKeepRemote={handleKeepRemote}
        onKeepBoth={handleKeepBoth}
      />

      {/* Error */}
      {error && (
        <p className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2 text-center">
          {error}
        </p>
      )}

      {/* Confirm button */}
      {selection !== null && (
        <Button
          onClick={handleConfirm}
          disabled={resolving}
          className="w-full gap-2"
        >
          <CheckCircle2 className="size-4" />
          {resolving
            ? "Applying…"
            : selection === "local"
              ? `Keep my version of "${filename}"`
              : `Keep their version of "${filename}"`}
        </Button>
      )}

      {/* Navigation hint */}
      <p className="text-[10px] text-center text-muted-foreground">
        Conflict {index + 1} of {total}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ConflictResolver
// ─────────────────────────────────────────────────────────────────────────────

export function ConflictResolver({
  pairId,
  conflicts,
  localDeviceName,
  remoteDeviceName,
  onResolve,
  onAllResolved,
  onDismiss,
}: ConflictResolverProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [resolvedPaths, setResolvedPaths] = useState<Set<string>>(new Set());

  const remaining = useMemo(
    () => conflicts.filter((c) => !resolvedPaths.has(c.path)),
    [conflicts, resolvedPaths],
  );

  const current = remaining[0] ?? null;

  const progress = useMemo(() => {
    if (conflicts.length === 0) return 100;
    return Math.round((resolvedPaths.size / conflicts.length) * 100);
  }, [conflicts.length, resolvedPaths.size]);

  const handleResolve = useCallback(
    async (resolution: ConflictResolution) => {
      if (!current) return;
      await onResolve(pairId, current.path, resolution);
      setResolvedPaths((prev) => new Set(prev).add(current.path));
    },
    [current, onResolve, pairId],
  );

  const handleNext = useCallback(() => {
    if (remaining.length <= 1) {
      // All conflicts resolved
      onAllResolved();
    } else {
      setCurrentIndex((prev) => Math.min(prev + 1, remaining.length - 2));
    }
  }, [remaining.length, onAllResolved]);

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }, []);

  // ── All resolved ───────────────────────────────────────────────────────────

  if (conflicts.length === 0 || remaining.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-10">
        <CheckCircle2 className="size-12 text-emerald-500" />
        <div className="text-center">
          <p className="text-sm font-semibold">All conflicts resolved!</p>
          <p className="text-xs text-muted-foreground mt-1">
            Sync will resume automatically.
          </p>
        </div>
        <Button onClick={onAllResolved} className="mt-2 gap-2">
          <ChevronRight className="size-4" />
          Continue
        </Button>
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <AlertTriangle className="size-4 text-orange-500" />
            Resolve Conflicts
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {remaining.length} remaining · choose which version to keep
          </p>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="text-xs text-muted-foreground h-8"
        >
          Defer
        </Button>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <Progress value={progress} className="h-1.5" />
        <p className="text-[10px] text-muted-foreground text-right">
          {resolvedPaths.size} / {conflicts.length} resolved
        </p>
      </div>

      {/* Navigation when there are multiple conflicts */}
      {remaining.length > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="gap-1 text-xs h-7"
          >
            <ChevronLeft className="size-3.5" />
            Prev
          </Button>

          <div className="flex gap-1">
            {remaining.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentIndex(i)}
                className={cn(
                  "size-1.5 rounded-full transition-colors",
                  i === currentIndex
                    ? "bg-primary"
                    : "bg-muted-foreground/30 hover:bg-muted-foreground/60",
                )}
              />
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleNext}
            disabled={currentIndex >= remaining.length - 1}
            className="gap-1 text-xs h-7"
          >
            Next
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Current conflict */}
      {current && (
        <ConflictView
          key={current.path}
          conflict={current}
          index={currentIndex}
          total={remaining.length}
          localDeviceName={localDeviceName}
          remoteDeviceName={remoteDeviceName}
          onResolve={handleResolve}
          onNext={handleNext}
        />
      )}
    </div>
  );
}
