/**
 * Sync Progress Component
 * Real-time sync progress overlay
 */

import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { SyncProgress } from "@/types/sync";
import { formatFileSize } from "@/lib/fileUtils";

interface SyncProgressProps {
  progress: SyncProgress;
  onCancel?: () => void;
}

export function SyncProgressOverlay({ progress, onCancel }: SyncProgressProps) {
  const progressPercent =
    progress.totalFiles > 0
      ? (progress.filesProcessed / progress.totalFiles) * 100
      : 0;

  const phaseLabels = {
    scanning: "Scanning files",
    comparing: "Comparing changes",
    transferring: "Transferring files",
    finalizing: "Finalizing sync",
  };

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="size-5 animate-spin text-primary" />
            Syncing Folder
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Phase */}
          <div className="text-center">
            <p className="text-2xl font-bold">{Math.round(progressPercent)}%</p>
            <p className="text-sm text-muted-foreground mt-1">
              {phaseLabels[progress.phase]}
            </p>
          </div>

          {/* Progress Bar */}
          <Progress value={progressPercent} className="h-2" />

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-2xl font-semibold">
                {progress.filesProcessed}/{progress.totalFiles}
              </p>
              <p className="text-xs text-muted-foreground">Files</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">
                {progress.speed > 0
                  ? formatFileSize(progress.speed) + "/s"
                  : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Speed</p>
            </div>
          </div>

          {/* Current File */}
          {progress.currentFile && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">
                Current file:
              </p>
              <p className="text-sm font-medium truncate">
                {progress.currentFile}
              </p>
            </div>
          )}

          {/* ETA */}
          {progress.eta > 0 && (
            <p className="text-center text-sm text-muted-foreground">
              Estimated time: {formatDuration(progress.eta)}
            </p>
          )}
        </div>

        {onCancel && (
          <div className="pt-4 border-t">
            <Button variant="outline" className="w-full" onClick={onCancel}>
              <X className="size-4 mr-2" />
              Cancel Sync
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}
