/**
 * Sync Item Component
 * Displays a single folder sync configuration
 */

import { Folder, RefreshCw, Settings, X, AlertCircle, CheckCircle2, Clock, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { SyncConfig, SyncState } from '@/types/sync';
import { formatFileSize } from '@/lib/fileUtils';
import { cn } from '@/lib/utils';

interface SyncItemProps {
  config: SyncConfig;
  state: SyncState | null;
  onSync: () => void;
  onDelete: () => void;
  onSettings?: () => void;
  isSyncing?: boolean;
}

function getStatusIcon(status: SyncState['status'] | null) {
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

function getStatusColor(status: SyncState['status'] | null) {
  switch (status) {
    case 'synced':
      return 'text-green-600 dark:text-green-400';
    case 'out-of-sync':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'syncing':
      return 'text-blue-600 dark:text-blue-400';
    case 'conflict':
      return 'text-red-600 dark:text-red-400';
    case 'error':
      return 'text-red-600 dark:text-red-400';
    case 'offline':
      return 'text-gray-600 dark:text-gray-400';
    default:
      return 'text-muted-foreground';
  }
}

function getStatusText(status: SyncState['status'] | null, state: SyncState | null): string {
  switch (status) {
    case 'synced':
      const lastSynced = state?.lastCheckedAt;
      if (lastSynced) {
        const minutesAgo = Math.floor((Date.now() - lastSynced) / 60000);
        if (minutesAgo < 1) return 'In sync (just now)';
        if (minutesAgo === 1) return 'In sync (1 min ago)';
        return `In sync (${minutesAgo} min ago)`;
      }
      return 'In sync';
    case 'out-of-sync':
      const localChanges = state?.pendingChanges.local.length || 0;
      const remoteChanges = state?.pendingChanges.remote.length || 0;
      const totalChanges = localChanges + remoteChanges;
      if (totalChanges > 0) {
        return `Out of sync (${totalChanges} file${totalChanges > 1 ? 's' : ''} changed)`;
      }
      return 'Out of sync';
    case 'syncing':
      return 'Syncing...';
    case 'conflict':
      const conflicts = state?.pendingChanges.conflicts.length || 0;
      return `Conflict (${conflicts} file${conflicts > 1 ? 's' : ''})`;
    case 'error':
      return `Error: ${state?.error || 'Unknown error'}`;
    case 'offline':
      return 'Peer offline';
    default:
      return 'Unknown status';
  }
}

export function SyncItem({ config, state, onSync, onDelete, onSettings, isSyncing }: SyncItemProps) {
  const StatusIcon = getStatusIcon(state?.status || null);
  const statusColor = getStatusColor(state?.status || null);
  const statusText = getStatusText(state?.status || null, state);

  const fileCount = state?.localSnapshot.length || 0;
  const totalSize = state?.localSnapshot.reduce((sum, file) => sum + file.size, 0) || 0;

  return (
    <Card className="relative">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-1">
              <Folder className="size-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base font-semibold truncate">
                {config.localFolderName}
              </CardTitle>
              <CardDescription className="mt-1">
                <span className="flex items-center gap-1.5">
                  <span>Syncing with:</span>
                  <span className="font-medium">{config.peerName}</span>
                </span>
              </CardDescription>
            </div>
          </div>
          <CardAction>
            <div className="flex items-center gap-2">
              {onSettings && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSettings}
                  className="h-8 w-8 p-0"
                >
                  <Settings className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              >
                <X className="size-4" />
              </Button>
            </div>
          </CardAction>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          {/* Status */}
          <div className="flex items-center gap-2">
            <StatusIcon className={cn('size-4', statusColor)} />
            <span className={cn('text-sm font-medium', statusColor)}>
              {statusText}
            </span>
          </div>

          {/* File info */}
          {fileCount > 0 && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
              <span>•</span>
              <span>{formatFileSize(totalSize)}</span>
            </div>
          )}

          {/* Direction badge */}
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {config.direction === 'bidirectional' && '↔ Bidirectional'}
              {config.direction === 'upload-only' && '↑ Upload only'}
              {config.direction === 'download-only' && '↓ Download only'}
            </Badge>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={onSync}
              disabled={isSyncing || state?.status === 'syncing' || state?.status === 'offline'}
              size="sm"
              className="flex-1"
            >
              {isSyncing || state?.status === 'syncing' ? (
                <>
                  <RefreshCw className="size-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="size-4 mr-2" />
                  Sync Now
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

