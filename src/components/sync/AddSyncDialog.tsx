/**
 * Add Sync Dialog Component
 * Dialog for creating a new folder sync
 */

import { useState } from 'react';
import { Folder, Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useFolderSync } from '@/hooks/useFolderSync';
import { useSession } from '@/contexts/SessionContext';
import type { SyncDirection, ConflictResolution } from '@/types/sync';
import { cn } from '@/lib/utils';

interface AddSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function AddSyncDialog({ open, onOpenChange, onSuccess }: AddSyncDialogProps) {
  const { peers } = useSession();
  const { createSync, browserCaps } = useFolderSync();
  
  const [selectedPeerId, setSelectedPeerId] = useState<string>('');
  const [direction, setDirection] = useState<SyncDirection>('bidirectional');
  const [conflictResolution, setConflictResolution] = useState<ConflictResolution>('last-write-wins');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!selectedPeerId) {
      setError('Please select a peer device');
      return;
    }

    const peer = peers.find((p) => p.id === selectedPeerId);
    if (!peer) {
      setError('Selected peer not found');
      return;
    }

    try {
      setIsCreating(true);
      setError(null);

      const config = await createSync(selectedPeerId, peer.name, direction, conflictResolution);
      
      if (config) {
        onSuccess?.();
        onOpenChange(false);
        // Reset form
        setSelectedPeerId('');
        setDirection('bidirectional');
        setConflictResolution('last-write-wins');
      } else {
        setError('Failed to create sync. Please try again.');
      }
    } catch (err) {
      console.error('Failed to create sync:', err);
      setError(err instanceof Error ? err.message : 'Failed to create sync');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      onOpenChange(false);
      setError(null);
      setSelectedPeerId('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Folder Sync</DialogTitle>
          <DialogDescription>
            Select a folder and peer device to start synchronizing files
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Browser capability notice */}
          {!browserCaps.hasFileSystemAccessAPI && (
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <AlertCircle className="size-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-yellow-900 dark:text-yellow-100">
                  Limited folder access
                </p>
                <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                  Your browser doesn't support full folder access. You'll need to select files manually.
                </p>
              </div>
            </div>
          )}

          {/* Peer Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Peer Device</label>
            {peers.length === 0 ? (
              <div className="p-4 border border-dashed rounded-lg text-center text-sm text-muted-foreground">
                No peers available. Make sure another device is connected to the same session.
              </div>
            ) : (
              <div className="space-y-2">
                {peers.map((peer) => (
                  <button
                    key={peer.id}
                    onClick={() => setSelectedPeerId(peer.id)}
                    className={cn(
                      'w-full p-3 border rounded-lg text-left transition-colors',
                      selectedPeerId === peer.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{peer.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {peer.deviceType}
                        </p>
                      </div>
                      {selectedPeerId === peer.id && (
                        <div className="size-2 bg-primary rounded-full" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sync Direction */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Sync Direction</label>
            <div className="grid grid-cols-3 gap-2">
              {(['bidirectional', 'upload-only', 'download-only'] as SyncDirection[]).map((dir) => (
                <button
                  key={dir}
                  onClick={() => setDirection(dir)}
                  className={cn(
                    'p-2 border rounded-lg text-xs font-medium transition-colors',
                    direction === dir
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent'
                  )}
                >
                  {dir === 'bidirectional' && '↔ Both'}
                  {dir === 'upload-only' && '↑ Upload'}
                  {dir === 'download-only' && '↓ Download'}
                </button>
              ))}
            </div>
          </div>

          {/* Conflict Resolution */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Conflict Resolution</label>
            <select
              value={conflictResolution}
              onChange={(e) => setConflictResolution(e.target.value as ConflictResolution)}
              className="w-full p-2 border rounded-lg text-sm bg-background"
            >
              <option value="last-write-wins">Last write wins</option>
              <option value="local-wins">Local wins</option>
              <option value="remote-wins">Remote wins</option>
              <option value="manual">Manual (ask me)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              How to handle files changed on both devices
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertCircle className="size-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isCreating || !selectedPeerId || peers.length === 0}
          >
            {isCreating ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Folder className="size-4 mr-2" />
                Select Folder & Create
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

