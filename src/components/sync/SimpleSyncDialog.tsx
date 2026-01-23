/**
 * Simple Sync Dialog - Simplified version that actually works
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
import { useFolderSync } from '@/hooks/useFolderSync';
import { useSession } from '@/contexts/SessionContext';
import { cn } from '@/lib/utils';

interface SimpleSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SimpleSyncDialog({ open, onOpenChange, onSuccess }: SimpleSyncDialogProps) {
  const { peers } = useSession();
  const { createSync, browserCaps } = useFolderSync();

  const [selectedPeerId, setSelectedPeerId] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onlinePeers = peers.filter((p) => p.isOnline);
  const selectedPeer = peers.find((p) => p.id === selectedPeerId);

  const handleCreate = async () => {
    if (!selectedPeerId || !selectedPeer) {
      setError('Please select a peer device');
      return;
    }

    try {
      setIsCreating(true);
      setError(null);

      // Simple bidirectional sync with last-write-wins
      const config = await createSync(
        selectedPeerId,
        selectedPeer.name,
        'bidirectional',
        'last-write-wins'
      );

      if (config) {
        onSuccess?.();
        handleClose();
      } else {
        setError('Folder selection cancelled or failed');
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
      setTimeout(() => {
        setSelectedPeerId('');
        setError(null);
      }, 300);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Folder className="size-5" />
            Create Folder Sync
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Keep a folder synchronized with another device
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Browser Capability Warning */}
          {!browserCaps.hasFileSystemAccessAPI && (
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs sm:text-sm">
              <AlertCircle className="size-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
              <p className="text-yellow-900 dark:text-yellow-100">
                Your browser has limited folder access. You may need to reselect the folder after page refresh.
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs sm:text-sm">
              <AlertCircle className="size-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <p className="text-red-900 dark:text-red-100">{error}</p>
            </div>
          )}

          {/* Peer Selection */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Select Device to Sync With</h4>

            {onlinePeers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center border-2 border-dashed rounded-lg">
                <AlertCircle className="size-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No online peers available
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Connect with another device first
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {onlinePeers.map((peer) => (
                  <button
                    key={peer.id}
                    onClick={() => setSelectedPeerId(peer.id)}
                    className={cn(
                      'w-full flex items-center justify-between gap-3 p-3 rounded-lg border-2 transition-all text-left',
                      selectedPeerId === peer.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-accent'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate text-sm">{peer.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{peer.deviceType}</p>
                    </div>
                    <div className="size-2 rounded-full bg-green-500 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-3 bg-muted/50 rounded-lg space-y-2 text-xs">
            <p className="font-medium">What happens next:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>• You'll be prompted to select a folder</li>
              <li>• Files will sync automatically both ways</li>
              <li>• Changes are detected every 60 seconds</li>
              <li>• Click "Sync Now" anytime to sync manually</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isCreating}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!selectedPeerId || isCreating || onlinePeers.length === 0}
            className="w-full sm:w-auto"
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
