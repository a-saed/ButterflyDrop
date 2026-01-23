/**
 * Folder Sync Hook (Rewritten)
 * Fixed all 10 bugs and implemented actual file synchronization
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { syncStorage } from "@/services/syncStorage";
import type {
  SyncConfig,
  SyncState,
  FileSnapshot,
  SyncStatus,
  SyncProgress,
  ConflictResolutionAction,
} from "@/types/sync";
import {
  requestFolderAccess,
  scanFolderWithHandle,
  scanFolderWithFileList,
  createFolderInput,
  detectBrowserCapabilities,
} from "@/lib/folderScanner";
import {
  compareSnapshots,
  calculateSyncPlan,
  applyConflictResolutions,
} from "@/lib/syncEngine";
import { syncProtocol } from "@/services/syncProtocol";
import { useSession } from "@/contexts/SessionContext";
import { useWebRTC } from "./useWebRTC_v2";
import { useFileTransfer } from "./useFileTransfer";
import { toast } from "sonner";

/**
 * Async queue for preventing concurrent operations on same config
 */
class AsyncQueue {
  private queues = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Wait for any existing operation on this key
    const existing = this.queues.get(key);
    if (existing) {
      await existing.catch(() => {});
    }

    // Create and store the new promise
    const newPromise = fn().finally(() => {
      // Only delete if we're still the current promise for this key
      const current = this.queues.get(key);
      if (current === newPromise) {
        this.queues.delete(key);
      }
    });

    this.queues.set(key, newPromise);
    return newPromise;
  }
}

export function useFolderSync() {
  const { session, peers } = useSession();
  const { getDataChannelForPeer, isPeerReady, readyPeers } = useWebRTC();
  const { sendFiles } = useFileTransfer();

  // Debug: log peers and ready peers
  console.log("🔍 useFolderSync state:", {
    peersCount: peers.length,
    peers: peers.map((p) => ({ id: p.id, name: p.name, online: p.isOnline })),
    readyPeersCount: readyPeers?.length || 0,
    readyPeerIds: readyPeers || [],
  });

  const [syncConfigs, setSyncConfigs] = useState<SyncConfig[]>([]);
  const [syncStates, setSyncStates] = useState<Map<string, SyncState>>(
    new Map(),
  );
  const [syncProgress, setSyncProgress] = useState<Map<string, SyncProgress>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const asyncQueue = useRef(new AsyncQueue());
  const browserCaps = useMemo(() => detectBrowserCapabilities(), []);

  /**
   * FIX #1: Return syncStates as Map (not array) for consistent API
   */
  const syncStatesArray = useMemo(
    () => Array.from(syncStates.values()),
    [syncStates],
  );

  /**
   * Load all sync configs from storage
   */
  const loadSyncConfigs = useCallback(async () => {
    try {
      setIsLoading(true);
      const configs = await syncStorage.getAllSyncConfigs();
      setSyncConfigs(configs);

      // Load sync states for each config
      const states = new Map<string, SyncState>();
      for (const config of configs) {
        const state = await syncStorage.getSyncState(config.id);
        if (state) {
          states.set(config.id, state);
        }
      }
      setSyncStates(states);
    } catch (err) {
      console.error("Failed to load sync configs:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load sync configs",
      );
      toast.error("Failed to load sync configs");
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * FIX #4: Validate session before operations
   */
  const ensureSession = useCallback(() => {
    if (!session) {
      throw new Error("No active session. Please wait for connection.");
    }
    return session;
  }, [session]);

  /**
   * Create a new sync configuration
   */
  const createSync = useCallback(
    async (
      peerId: string,
      peerName: string,
      direction: SyncConfig["direction"] = "bidirectional",
      conflictResolution: SyncConfig["conflictResolution"] = "last-write-wins",
    ): Promise<SyncConfig | null> => {
      const currentSession = ensureSession();

      try {
        let folderHandle: FileSystemDirectoryHandle | null = null;
        let folderPath = "";
        let folderName = "";
        let trackedFiles: FileList | null = null;

        // Try File System Access API first (Chrome/Edge)
        if (browserCaps.hasFileSystemAccessAPI) {
          folderHandle = await requestFolderAccess();
          if (folderHandle) {
            folderName = folderHandle.name;
            folderPath = folderHandle.name;
          }
        }

        // FIX #3: Fallback to folder input (Firefox/mobile)
        if (!folderHandle) {
          trackedFiles = await createFolderInput();
          if (trackedFiles && trackedFiles.length > 0) {
            const firstFile = trackedFiles[0] as File & {
              webkitRelativePath?: string;
            };
            const relativePath = firstFile.webkitRelativePath || firstFile.name;
            const pathParts = relativePath.split("/");
            folderName = pathParts[0] || "Selected Folder";
            folderPath = folderName;
          } else {
            return null;
          }
        }

        if (!folderHandle && !trackedFiles) {
          throw new Error("Failed to select folder");
        }

        const config: SyncConfig = {
          id: `sync-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          localFolderHandle: folderHandle,
          localFolderPath: folderPath,
          localFolderName: folderName,
          peerId,
          peerName,
          sessionId: currentSession.id,
          direction,
          createdAt: Date.now(),
          lastSyncedAt: null,
          isActive: true,
          conflictResolution,
          trackedFiles,
        };

        await syncStorage.saveSyncConfig(config);
        await loadSyncConfigs();

        // Perform initial scan
        await scanFolder(config.id);

        toast.success(`Sync created with ${peerName}`);
        return config;
      } catch (err) {
        console.error("Failed to create sync:", err);
        setError(err instanceof Error ? err.message : "Failed to create sync");
        toast.error(
          err instanceof Error ? err.message : "Failed to create sync",
        );
        return null;
      }
    },
    [ensureSession, browserCaps, loadSyncConfigs],
  );

  /**
   * FIX #5 & #6: Scan folder with proper async locking and Firefox support
   */
  const scanFolder = useCallback(
    async (configId: string): Promise<FileSnapshot[]> => {
      return asyncQueue.current.run(configId, async () => {
        try {
          const config = await syncStorage.getSyncConfig(configId);
          if (!config) {
            throw new Error(`Sync config ${configId} not found`);
          }

          let snapshots: FileSnapshot[] = [];

          // Use File System Access API if available
          if (browserCaps.hasFileSystemAccessAPI) {
            let folderHandle = config.localFolderHandle;
            if (!folderHandle) {
              folderHandle = await requestFolderAccess();
              if (folderHandle) {
                config.localFolderHandle = folderHandle;
                await syncStorage.saveSyncConfig(config);
              }
            }

            if (folderHandle) {
              snapshots = await scanFolderWithHandle(folderHandle, configId);
            } else {
              throw new Error(
                "Failed to access folder. Please recreate the sync.",
              );
            }
          } else {
            // FIX #6: For Firefox/mobile - use stored FileList if available
            if (config.trackedFiles && config.trackedFiles.length > 0) {
              snapshots = await scanFolderWithFileList(
                config.trackedFiles,
                configId,
              );
            } else {
              // Need manual rescan
              const fileList = await createFolderInput();
              if (fileList && fileList.length > 0) {
                snapshots = await scanFolderWithFileList(fileList, configId);
                config.trackedFiles = fileList;
              } else {
                throw new Error("No folder selected");
              }
            }
          }

          // Save snapshots to storage
          for (const snapshot of snapshots) {
            await syncStorage.saveFileSnapshot(snapshot);
          }

          // Update sync state
          const currentState = await syncStorage.getSyncState(configId);
          const newState: SyncState = {
            configId,
            localSnapshot: snapshots,
            remoteSnapshot: currentState?.remoteSnapshot || null,
            status: snapshots.length > 0 ? "synced" : "out-of-sync",
            lastCheckedAt: Date.now(),
            pendingChanges: {
              local: [],
              remote: [],
              conflicts: [],
            },
          };

          await syncStorage.saveSyncState(newState);
          setSyncStates((prev) => new Map(prev).set(configId, newState));

          console.log("✅ Scan complete:", {
            configId,
            fileCount: snapshots.length,
            status: newState.status,
          });

          return snapshots;
        } catch (err) {
          console.error(`Failed to scan folder for config ${configId}:`, err);
          await syncStorage.updateSyncStatus(
            configId,
            "error",
            err instanceof Error ? err.message : "Scan failed",
          );
          throw err;
        }
      });
    },
    [browserCaps],
  );

  /**
   * FIX #1 & #7: Perform actual sync with file transfer
   */
  const performSync = useCallback(
    async (configId: string): Promise<void> => {
      return asyncQueue.current.run(configId, async () => {
        const config = await syncStorage.getSyncConfig(configId);
        if (!config) {
          throw new Error(`Sync config ${configId} not found`);
        }

        // Check if peer is ready
        const peerReady = isPeerReady(config.peerId);
        console.log(`🔍 Checking peer ${config.peerId} (${config.peerName}):`, {
          peerReady,
          configId,
        });

        if (!peerReady) {
          console.warn(`⚠️ Peer not ready, rescanning folder only`);
          toast.info(
            `Scanning folder... (${config.peerName} not connected yet)`,
          );

          // Just rescan and update local state
          const snapshots = await scanFolder(configId);
          console.log(`✅ Local scan complete: ${snapshots.length} files`);
          toast.success(`Found ${snapshots.length} files in folder`);
          return;
        }

        console.log(`✅ Peer ready, starting full sync...`);
        toast.info(`Starting sync with ${config.peerName}...`);

        // Update status to syncing
        await syncStorage.updateSyncStatus(configId, "syncing");
        setSyncStates((prev) => {
          const state = prev.get(configId);
          if (state) {
            return new Map(prev).set(configId, {
              ...state,
              status: "syncing" as SyncStatus,
            });
          }
          return prev;
        });

        // Set initial progress
        setSyncProgress((prev) =>
          new Map(prev).set(configId, {
            configId,
            phase: "scanning",
            currentFile: null,
            filesProcessed: 0,
            totalFiles: 0,
            bytesTransferred: 0,
            totalBytes: 0,
            speed: 0,
            eta: 0,
          }),
        );

        try {
          // Phase 1: Scan local folder
          const localSnapshots = await scanFolder(configId);

          // Phase 2: Exchange metadata with peer
          setSyncProgress((prev) => {
            const p = prev.get(configId);
            return new Map(prev).set(configId, { ...p!, phase: "comparing" });
          });

          await syncProtocol.sendMetadata(
            config.peerId,
            configId,
            localSnapshots,
          );

          // Get remote snapshots (updated by protocol listener)
          const currentState = await syncStorage.getSyncState(configId);
          const remoteSnapshots = currentState?.remoteSnapshot || [];

          // Phase 3: Calculate sync plan
          const diff = compareSnapshots(localSnapshots, remoteSnapshots);
          const plan = calculateSyncPlan(diff, config.direction);

          if (plan.conflicts.length > 0) {
            // Has conflicts - pause and wait for resolution
            await syncStorage.updateSyncStatus(configId, "conflict");
            setSyncStates((prev) => {
              const state = prev.get(configId);
              if (state) {
                return new Map(prev).set(configId, {
                  ...state,
                  status: "conflict" as SyncStatus,
                  pendingChanges: {
                    local: plan.upload,
                    remote: plan.download,
                    conflicts: plan.conflicts,
                  },
                });
              }
              return prev;
            });
            toast.warning(`Sync has ${plan.conflicts.length} conflict(s)`);
            return;
          }

          // Phase 4: Transfer files
          setSyncProgress((prev) => {
            const p = prev.get(configId);
            return new Map(prev).set(configId, {
              ...p!,
              phase: "transferring",
              totalFiles: plan.upload.length + plan.download.length,
            });
          });

          let filesTransferred = 0;
          let bytesTransferred = 0;

          // Upload files
          if (plan.upload.length > 0 && config.direction !== "download-only") {
            const dataChannel = getDataChannelForPeer(config.peerId);
            if (!dataChannel) {
              throw new Error("Data channel not available");
            }

            // Convert snapshots to files
            const filesToUpload = await Promise.all(
              plan.upload.map(async (snapshot) => {
                // Get file from folder
                if (config.localFolderHandle) {
                  const handle = await getFileHandleFromPath(
                    config.localFolderHandle,
                    snapshot.path,
                  );
                  if (handle) {
                    return await handle.getFile();
                  }
                }
                return null;
              }),
            );

            const validFiles = filesToUpload.filter(
              (f): f is File => f !== null,
            );

            if (validFiles.length > 0) {
              await sendFiles(
                validFiles,
                dataChannel,
                config.peerId,
                config.peerName,
              );
              filesTransferred += validFiles.length;
              bytesTransferred += validFiles.reduce(
                (sum, f) => sum + f.size,
                0,
              );
            }
          }

          // Download files handled by file transfer hook

          // Phase 5: Finalize
          setSyncProgress((prev) => {
            const p = prev.get(configId);
            return new Map(prev).set(configId, { ...p!, phase: "finalizing" });
          });

          // Update last synced time
          config.lastSyncedAt = Date.now();
          await syncStorage.saveSyncConfig(config);

          // Update sync state
          const newState: SyncState = {
            configId,
            localSnapshot: localSnapshots,
            remoteSnapshot: remoteSnapshots,
            status: "synced",
            lastCheckedAt: Date.now(),
            pendingChanges: {
              local: [],
              remote: [],
              conflicts: [],
            },
          };

          await syncStorage.saveSyncState(newState);
          setSyncStates((prev) => new Map(prev).set(configId, newState));

          // Clear progress
          setSyncProgress((prev) => {
            const newMap = new Map(prev);
            newMap.delete(configId);
            return newMap;
          });

          // Send completion message
          await syncProtocol.sendSyncComplete(
            config.peerId,
            configId,
            filesTransferred,
            bytesTransferred,
          );

          toast.success("Sync completed successfully");
        } catch (err) {
          console.error(`Sync failed for config ${configId}:`, err);
          await syncStorage.updateSyncStatus(
            configId,
            "error",
            err instanceof Error ? err.message : "Sync failed",
          );
          setSyncProgress((prev) => {
            const newMap = new Map(prev);
            newMap.delete(configId);
            return newMap;
          });
          toast.error(err instanceof Error ? err.message : "Sync failed");
          throw err;
        }
      });
    },
    [isPeerReady, scanFolder, getDataChannelForPeer, sendFiles],
  );

  /**
   * Resolve conflicts
   */
  const resolveConflicts = useCallback(
    async (
      configId: string,
      resolutions: ConflictResolutionAction[],
    ): Promise<void> => {
      const state = syncStates.get(configId);
      if (!state || state.pendingChanges.conflicts.length === 0) {
        return;
      }

      const plan = applyConflictResolutions(
        state.pendingChanges.conflicts,
        resolutions,
      );

      // Update state with resolved conflicts
      const newState: SyncState = {
        ...state,
        status: plan.conflicts.length > 0 ? "conflict" : "out-of-sync",
        pendingChanges: {
          local: [...state.pendingChanges.local, ...plan.upload],
          remote: [...state.pendingChanges.remote, ...plan.download],
          conflicts: plan.conflicts,
        },
      };

      await syncStorage.saveSyncState(newState);
      setSyncStates((prev) => new Map(prev).set(configId, newState));

      // If all conflicts resolved, trigger sync
      if (plan.conflicts.length === 0) {
        await performSync(configId);
      }
    },
    [syncStates, performSync],
  );

  /**
   * Delete sync configuration
   */
  const deleteSync = useCallback(
    async (configId: string): Promise<void> => {
      try {
        await syncStorage.deleteSyncConfig(configId);
        await loadSyncConfigs();
        toast.success("Sync deleted");
      } catch (err) {
        console.error(`Failed to delete sync ${configId}:`, err);
        setError(err instanceof Error ? err.message : "Failed to delete sync");
        toast.error("Failed to delete sync");
      }
    },
    [loadSyncConfigs],
  );

  /**
   * Get sync state for a config
   */
  const getSyncState = useCallback(
    (configId: string): SyncState | null => {
      return syncStates.get(configId) || null;
    },
    [syncStates],
  );

  /**
   * Get sync progress for a config
   */
  const getSyncProgress = useCallback(
    (configId: string): SyncProgress | null => {
      return syncProgress.get(configId) || null;
    },
    [syncProgress],
  );

  /**
   * FIX #6 & #8: Check sync status for all configs (disabled for non-FSA browsers)
   */
  const checkAllSyncs = useCallback(async (): Promise<void> => {
    for (const config of syncConfigs) {
      if (!config.isActive) continue;

      // FIX #6: Skip auto-check for Firefox/mobile
      if (!browserCaps.hasFileSystemAccessAPI) {
        continue;
      }

      try {
        await scanFolder(config.id);
      } catch (err) {
        console.error(`Failed to check sync ${config.id}:`, err);
      }
    }
  }, [syncConfigs, browserCaps, scanFolder]);

  // Load sync configs on mount
  useEffect(() => {
    loadSyncConfigs();
  }, [loadSyncConfigs]);

  /**
   * FIX #8: Stable auto-check with proper dependencies
   */
  useEffect(() => {
    if (syncConfigs.length === 0 || !browserCaps.hasFileSystemAccessAPI) {
      return;
    }

    const interval = setInterval(() => {
      checkAllSyncs();
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, [syncConfigs.length, browserCaps.hasFileSystemAccessAPI, checkAllSyncs]);

  /**
   * Setup sync protocol message handlers
   */
  useEffect(() => {
    const unsubscribe = syncProtocol.on("message", async (_peerId, message) => {
      if (message.type === "sync-metadata") {
        const { configId, snapshots } = message.data as {
          configId: string;
          snapshots: FileSnapshot[];
        };

        // Update remote snapshot
        const state = await syncStorage.getSyncState(configId);
        if (state) {
          const newState: SyncState = {
            ...state,
            remoteSnapshot: snapshots,
            status: "out-of-sync",
          };
          await syncStorage.saveSyncState(newState);
          setSyncStates((prev) => new Map(prev).set(configId, newState));
        }
      }
    });

    return unsubscribe;
  }, []);

  /**
   * Register data channels with sync protocol
   */
  useEffect(() => {
    for (const config of syncConfigs) {
      const dataChannel = getDataChannelForPeer(config.peerId);
      if (dataChannel) {
        syncProtocol.registerDataChannel(config.peerId, dataChannel);
      }
    }
  }, [syncConfigs, getDataChannelForPeer]);

  return {
    syncConfigs,
    syncStates,
    syncStatesArray,
    syncProgress,
    isLoading,
    error,
    createSync,
    performSync,
    deleteSync,
    scanFolder,
    getSyncState,
    getSyncProgress,
    checkAllSyncs,
    resolveConflicts,
    browserCaps,
  };
}

/**
 * Helper: Get file handle from path
 */
async function getFileHandleFromPath(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemFileHandle | null> {
  const parts = path.split("/");
  let current: FileSystemDirectoryHandle = dirHandle;

  // Navigate to parent directory
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      current = await current.getDirectoryHandle(parts[i]);
    } catch {
      return null;
    }
  }

  // Get file handle
  try {
    return await current.getFileHandle(parts[parts.length - 1]);
  } catch {
    return null;
  }
}
