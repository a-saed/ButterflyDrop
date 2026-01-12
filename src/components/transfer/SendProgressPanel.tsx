import { Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { TransferProgress } from "@/types/transfer";

interface SendProgressPanelProps {
  isSending: boolean;
  sendProgress: TransferProgress | null;
  sendComplete: boolean;
  sendError: string | null;
  peerName: string;
  onReset: () => void;
  formatBytes: (bytes: number) => string;
}

export function SendProgressPanel({
  isSending,
  sendProgress,
  sendComplete,
  sendError,
  peerName,
  onReset,
  formatBytes,
}: SendProgressPanelProps) {
  // Don't show if nothing to show
  if (!isSending && !sendComplete && !sendError) {
    return null;
  }

  // Show error
  if (sendError) {
    return (
      <Card className="p-4 border-red-500/50 bg-red-500/5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
            <XCircle className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-500">Send Failed</p>
            <p className="text-xs text-muted-foreground">{sendError}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onReset}>
            Dismiss
          </Button>
        </div>
      </Card>
    );
  }

  // Show success
  if (sendComplete) {
    return (
      <Card className="p-4 border-green-500/50 bg-green-500/5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">Files Sent!</p>
            <p className="text-xs text-muted-foreground">
              Successfully sent to {peerName}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onReset}>
            Done
          </Button>
        </div>
      </Card>
    );
  }

  // Show progress
  if (isSending && sendProgress) {
    return (
      <Card className="p-4 border-primary/50">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Upload className="h-5 w-5 text-primary animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Sending to {peerName}</p>
              <p className="text-xs text-muted-foreground truncate">
                {sendProgress.fileName}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium">{Math.round(sendProgress.percentage)}%</p>
              <p className="text-xs text-muted-foreground">{formatBytes(sendProgress.speed)}/s</p>
            </div>
          </div>

          {/* Progress bar */}
          <Progress value={sendProgress.percentage} className="h-2" />

          {/* Stats */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatBytes(sendProgress.bytesTransferred)} / {formatBytes(sendProgress.totalBytes)}</span>
            <span>{Math.ceil(sendProgress.eta)}s remaining</span>
          </div>
        </div>
      </Card>
    );
  }

  // Show sending state without progress yet
  if (isSending) {
    return (
      <Card className="p-4 border-primary/50">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Preparing transfer...</p>
            <p className="text-xs text-muted-foreground">Sending to {peerName}</p>
          </div>
        </div>
      </Card>
    );
  }

  return null;
}

