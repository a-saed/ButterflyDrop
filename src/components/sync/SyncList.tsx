/**
 * Sync List Component
 * Displays all active folder syncs
 */

import { useState } from 'react';
import { FolderPlus, Loader2 } from 'lucide-react';
import { useFolderSync } from '@/hooks/useFolderSync';
import { SyncItem } from './SyncItem';
import { AddSyncDialog } from './AddSyncDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function SyncList() {
  const {
    syncConfigs,
    syncStates,
    isLoading,
    error,
    performSync,
    deleteSync,
  } = useFolderSync();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [syncingConfigId, setSyncingConfigId] = useState<string | null>(null);

  const handleSync = async (configId: string) => {
    try {
      setSyncingConfigId(configId);
      await performSync(configId);
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncingConfigId(null);
    }
  };

  const handleDelete = async (configId: string) => {
    if (confirm('Are you sure you want to remove this folder sync?')) {
      await deleteSync(configId);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="text-center text-destructive">
            <p className="font-medium">Error loading syncs</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Synced Folders</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Keep your folders synchronized across devices
          </p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)}>
          <FolderPlus className="size-4 mr-2" />
          Add Folder Sync
        </Button>
      </div>

      {/* Sync List */}
      {syncConfigs.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <FolderPlus className="size-12 mx-auto text-muted-foreground mb-4 opacity-50" />
              <p className="text-muted-foreground font-medium">No folder syncs yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add a folder sync to start keeping your files synchronized
              </p>
              <Button
                onClick={() => setIsAddDialogOpen(true)}
                className="mt-4"
                variant="outline"
              >
                <FolderPlus className="size-4 mr-2" />
                Add Your First Sync
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {syncConfigs.map((config) => {
            const state = syncStates.find((s) => s.configId === config.id) || null;
            return (
              <SyncItem
                key={config.id}
                config={config}
                state={state}
                onSync={() => handleSync(config.id)}
                onDelete={() => handleDelete(config.id)}
                isSyncing={syncingConfigId === config.id}
              />
            );
          })}
        </div>
      )}

      {/* Add Sync Dialog */}
      <AddSyncDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onSuccess={() => setIsAddDialogOpen(false)}
      />
    </div>
  );
}

