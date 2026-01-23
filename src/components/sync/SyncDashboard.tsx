/**
 * Sync Dashboard Component
 * Modern dashboard displaying all folder syncs
 */

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SyncCard } from "./SyncCard";
import { useFolderSync } from "@/hooks/useFolderSync";

interface SyncDashboardProps {
  onAddSync: () => void;
}

export function SyncDashboard({ onAddSync }: SyncDashboardProps) {
  const {
    syncConfigs,
    getSyncState,
    getSyncProgress,
    performSync,
    deleteSync,
    isLoading,
  } = useFolderSync();

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-32 bg-muted/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (syncConfigs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="size-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
          <Plus className="size-10 text-primary" />
        </div>
        <h3 className="text-xl font-semibold mb-2">No Folder Syncs Yet</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
          Create your first folder sync to automatically keep files synchronized
          between devices
        </p>
        <Button onClick={onAddSync} size="lg">
          <Plus className="size-5 mr-2" />
          Create Folder Sync
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Folder Syncs</h3>
          <p className="text-sm text-muted-foreground">
            {syncConfigs.length} sync{syncConfigs.length !== 1 ? "s" : ""}{" "}
            configured
          </p>
        </div>
        <Button onClick={onAddSync} size="sm">
          <Plus className="size-4 mr-2" />
          Add Sync
        </Button>
      </div>

      <div className="space-y-3">
        {syncConfigs.map((config) => {
          const state = getSyncState(config.id);
          const progress = getSyncProgress(config.id);

          return (
            <SyncCard
              key={config.id}
              config={config}
              state={state}
              progress={progress}
              onSync={() => performSync(config.id)}
              onDelete={() => deleteSync(config.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
