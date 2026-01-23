/**
 * Sync Card Component
 * Modern card displaying a single folder sync with glassmorphism
 */

import {
  Folder,
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  WifiOff,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { SyncConfig, SyncState, SyncProgress } from '@/types/sync';
import { formatFileSize } from '@/lib/fileUtils';
import { cn } from '@/lib/utils';

interface SyncCardProps {
  config: SyncConfig;
  state: SyncState | null;
  progress: SyncProgress | null;
  onSync: () => void;
  onDelete: () => void;
}

function getStatusIcon(status: SyncState['status'] | null, isSyncing: boolean) {
  if (isSyncing) return RefreshCw;

  switch (status) {
    case 'synced':
      return CheckCircle2;
    case 'out-of-sync':
      return Clock;
    case 'syncing':
      return RefreshCw;
    case 'conflict':
      return AlertCircle;
    case 'error':
      return AlertCircle;
    case 'offline':
      return WifiOff;
    default:
      return Clock;
  }
}

function getStatusColor(status: SyncState['status'] | null, isSyncing: boolean) {
  if (isSyncing) return 'text-blue-600 dark:text-blue-400';

  switch (status) {
    case 'synced':
      return 'text-green-600 dark:text-green-400';
    case 'out-of-sync':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'syncing':
      return 'text-blue-600 dark:text-blue-400';
    case 'conflict':
      return 'text-orange-600 dark:text-orange-400';
    case 'error':
      return 'text-red-600 dark:text-red-400';
    case 'offline':
      return 'text-gray-600 dark:text-gray-400';
    default:
      return 'text-muted-foreground';
  }
}

function getStatusBadgeColor(status: SyncState['status'] | null, isSyncing: boolean) {
  if (isSyncing) return 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400';

  switch (status) {
    case 'synced':
      return 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400';
    case 'out-of-sync':
      return 'bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400';
    case 'syncing':
      return 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400';
    case 'conflict':
      return 'bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-400';
    case 'error':
      return 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400';
    case 'offline':
      return 'bg-gray-500/10 border-gray-500/20 text-gray-600 dark:text-gray-400';
    default:
      return 'bg-muted border-border text-muted-foreground';
  }
}

function getStatusText(status: SyncState['status'] | null, progress: SyncProgress | null): string {
  if (progress) {
    return `${progress.phase.charAt(0).toUpperCase() + progress.phase.slice(1)}...`;
  }

  switch (status) {
    case 'synced':
      return 'In Sync';
    case 'out-of-sync':
      return 'Out of Sync';
    case 'syncing':
      return 'Syncing';
    case 'conflict':
      return 'Conflict';
    case 'error':
      return 'Error';
    case 'offline':
      return 'Offline';
    default:
      return 'Unknown';
  }
}

export function SyncCard({ config, state, progress, onSync, onDelete }: SyncCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isSyncing = progress !== null;

  const StatusIcon = getStatusIcon(state?.status || null, isSyncing);
  const statusColor = getStatusColor(state?.status || null, isSyncing);
  const statusBadgeColor = getStatusBadgeColor(state?.status || null, isSyncing);
  const statusText = getStatusText(state?.status || null, progress);

  const fileCount = state?.localSnapshot.length || 0;
  const totalSize = state?.localSnapshot.reduce((sum, file) => sum + file.size, 0) || 0;

  const lastSynced = config.lastSyncedAt;
  const lastSyncedText = lastSynced
    ? `Last synced ${formatRelativeTime(lastSynced)}`
    : 'Never synced';

  const progressPercent = progress
    ? progress.totalFiles > 0
      ? (progress.filesProcessed / progress.totalFiles) * 100
      : 0
    : null;

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-card transition-all duration-300',
        'hover:shadow-lg hover:scale-[1.01]',
        isSyncing && 'shadow-md'
      )}
    >
      {/* Glassmorphism Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 opacity-50" />

      <div className="relative p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-1 shrink-0">
              <Folder className="size-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold truncate">{config.localFolderName}</h4>
              <p className="text-sm text-muted-foreground truncate">
                → {config.peerName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant="outline"
              className={cn('border transition-colors duration-150', statusBadgeColor)}
            >
              <StatusIcon
                className={cn('size-3 mr-1.5', statusColor, isSyncing && 'animate-spin')}
              />
              {statusText}
            </Badge>

            <Button
              variant="ghost"
              size="icon"
              className="size-8 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={onDelete}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Progress Bar */}
        {progressPercent !== null && (
          <div className="mb-3">
            <Progress value={progressPercent} className="h-1.5" />
            <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
              <span>
                {progress?.filesProcessed || 0} / {progress?.totalFiles || 0} files
              </span>
              {progress && progress.speed > 0 && (
                <span>{formatFileSize(progress.speed)}/s</span>
              )}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4 text-muted-foreground">
            <span>{fileCount} files</span>
            <span>•</span>
            <span>{formatFileSize(totalSize)}</span>
            <span>•</span>
            <span className="capitalize">{config.direction.replace('-', ' ')}</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3"
            onClick={onSync}
            disabled={isSyncing || state?.status === 'offline'}
          >
            <RefreshCw
              className={cn('size-4 mr-1.5', isSyncing && 'animate-spin')}
            />
            Sync Now
          </Button>
        </div>

        {/* Last Synced */}
        <p className="text-xs text-muted-foreground mt-2">{lastSyncedText}</p>

        {/* Expandable Details */}
        {state && state.pendingChanges && (
          <>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mt-3 w-full"
            >
              {isExpanded ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
              <span>
                {isExpanded ? 'Hide' : 'Show'} details
              </span>
            </button>

            {isExpanded && (
              <div className="mt-3 pt-3 border-t space-y-2 text-xs animate-in fade-in slide-in-from-top-2 duration-200">
                {state.pendingChanges.local.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Local changes: </span>
                    <span className="font-medium">{state.pendingChanges.local.length}</span>
                  </div>
                )}
                {state.pendingChanges.remote.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Remote changes: </span>
                    <span className="font-medium">{state.pendingChanges.remote.length}</span>
                  </div>
                )}
                {state.pendingChanges.conflicts.length > 0 && (
                  <div>
                    <span className="text-orange-600 dark:text-orange-400">Conflicts: </span>
                    <span className="font-medium">{state.pendingChanges.conflicts.length}</span>
                  </div>
                )}
                {state.error && (
                  <div className="text-red-600 dark:text-red-400">
                    {state.error}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
