/**
 * Folder Sync Hook
 * Main hook for managing folder synchronization
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { syncStorage } from '@/services/syncStorage';
import type { SyncConfig, SyncState, FileSnapshot, SyncStatus } from '@/types/sync';
import {
  requestFolderAccess,
  scanFolderWithHandle,
  scanFolderWithFileList,
  createFolderInput,
  compareSnapshots,
  detectBrowserCapabilities,
} from '@/lib/folderScanner';
import { useSession } from '@/contexts/SessionContext';
import { useWebRTC } from './useWebRTC_v2';
import { useFileTransfer } from './useFileTransfer';

export function useFolderSync() {
  const { session, peers } = useSession();
  const { getDataChannelForPeer, isPeerReady } = useWebRTC();
  const { sendFiles } = useFileTransfer();
  
  const [syncConfigs, setSyncConfigs] = useState<SyncConfig[]>([]);
  const [syncStates, setSyncStates] = useState<Map<string, SyncState>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scanningRef = useRef<Set<string>>(new Set());
  const syncIntervalRef = useRef<Map<string, number>>(new Map());

  const browserCaps = detectBrowserCapabilities();

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
      console.error('Failed to load sync configs:', err);
      setError(err instanceof Error ? err.message : 'Failed to load sync configs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create a new sync configuration
   */
  const createSync = useCallback(async (
    peerId: string,
    peerName: string,
    direction: SyncConfig['direction'] = 'bidirectional',
    conflictResolution: SyncConfig['conflictResolution'] = 'last-write-wins'
  ): Promise<SyncConfig | null> => {
    if (!session) {
      throw new Error('No active session');
    }

    try {
      let folderHandle: FileSystemDirectoryHandle | null = null;
      let folderPath = '';
      let folderName = '';
      let trackedFiles: FileList | null = null;

      // Try File System Access API first (Chrome/Edge)
      if (browserCaps.hasFileSystemAccessAPI) {
        folderHandle = await requestFolderAccess();
        if (folderHandle) {
          folderName = folderHandle.name;
          folderPath = folderHandle.name;
        }
      }

      // Fallback to folder input (Firefox/mobile)
      if (!folderHandle) {
        trackedFiles = await createFolderInput();
        if (trackedFiles && trackedFiles.length > 0) {
          // Get folder name from first file's webkitRelativePath
          const firstFile = trackedFiles[0] as File & { webkitRelativePath?: string };
          const relativePath = firstFile.webkitRelativePath || firstFile.name;
          const pathParts = relativePath.split('/');
          folderName = pathParts[0] || 'Selected Folder';
          folderPath = folderName;
        } else {
          // User cancelled
          return null;
        }
      }

      if (!folderHandle && !trackedFiles) {
        throw new Error('Failed to select folder');
      }

      // Create sync config
      const config: SyncConfig = {
        id: `sync-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        localFolderHandle: folderHandle,
        localFolderPath: folderPath,
        localFolderName: folderName,
        peerId,
        peerName,
        sessionId: session.id,
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

      return config;
    } catch (err) {
      console.error('Failed to create sync:', err);
      setError(err instanceof Error ? err.message : 'Failed to create sync');
      return null;
    }
  }, [session, browserCaps, loadSyncConfigs]);

  /**
   * Scan folder and create file snapshots
   */
  const scanFolder = useCallback(async (configId: string): Promise<FileSnapshot[]> => {
    if (scanningRef.current.has(configId)) {
      console.log(`Already scanning folder for config ${configId}`);
      return [];
    }

    scanningRef.current.add(configId);

    try {
      const config = await syncStorage.getSyncConfig(configId);
      if (!config) {
        throw new Error(`Sync config ${configId} not found`);
      }

      let snapshots: FileSnapshot[] = [];

      // Use File System Access API if available
      if (browserCaps.hasFileSystemAccessAPI) {
        // Re-request folder access if handle is null (was stored without handle)
        let folderHandle = config.localFolderHandle;
        if (!folderHandle) {
          // Try to re-request folder access
          folderHandle = await requestFolderAccess();
          if (folderHandle) {
            // Update config with new handle
            config.localFolderHandle = folderHandle;
            await syncStorage.saveSyncConfig(config);
          }
        }
        
        if (folderHandle) {
          snapshots = await scanFolderWithHandle(
            folderHandle,
            configId
          );
        } else {
          throw new Error('Failed to access folder. Please recreate the sync.');
        }
      } else {
        // For Firefox/mobile: re-request folder selection
        // Note: This is a limitation - user needs to reselect folder each time
        const fileList = await createFolderInput();
        if (fileList && fileList.length > 0) {
          snapshots = await scanFolderWithFileList(fileList, configId);
          // Update config with new file list reference (won't persist, but that's OK)
          config.trackedFiles = fileList;
        } else {
          throw new Error('No folder selected');
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
        status: 'out-of-sync',
        lastCheckedAt: Date.now(),
        pendingChanges: {
          local: [],
          remote: [],
          conflicts: [],
        },
      };

      await syncStorage.saveSyncState(newState);
      setSyncStates(prev => new Map(prev).set(configId, newState));

      return snapshots;
    } catch (err) {
      console.error(`Failed to scan folder for config ${configId}:`, err);
      await syncStorage.updateSyncStatus(configId, 'error', err instanceof Error ? err.message : 'Scan failed');
      throw err;
    } finally {
      scanningRef.current.delete(configId);
    }
  }, []);

  /**
   * Perform sync with peer
   */
  const performSync = useCallback(async (configId: string): Promise<void> => {
    const config = await syncStorage.getSyncConfig(configId);
    if (!config) {
      throw new Error(`Sync config ${configId} not found`);
    }

    // Check if peer is ready
    if (!isPeerReady(config.peerId)) {
      await syncStorage.updateSyncStatus(configId, 'offline');
      setSyncStates(prev => {
        const state = prev.get(configId);
        if (state) {
          const newState = { ...state, status: 'offline' as SyncStatus };
          return new Map(prev).set(configId, newState);
        }
        return prev;
      });
      throw new Error('Peer is not connected');
    }

    // Update status to syncing
    await syncStorage.updateSyncStatus(configId, 'syncing');
    setSyncStates(prev => {
      const state = prev.get(configId);
      if (state) {
        const newState = { ...state, status: 'syncing' as SyncStatus };
        return new Map(prev).set(configId, newState);
      }
      return prev;
    });

    try {
      // Scan local folder
      const localSnapshots = await scanFolder(configId);

      // Get data channel for peer
      const dataChannel = getDataChannelForPeer(config.peerId);
      if (!dataChannel) {
        throw new Error('Data channel not available');
      }

      // TODO: Exchange metadata with peer
      // For now, just mark as synced after scanning
      // In Phase 2, we'll implement the actual sync protocol

      // Update last synced time
      config.lastSyncedAt = Date.now();
      await syncStorage.saveSyncConfig(config);

      // Update sync state
      const currentState = await syncStorage.getSyncState(configId);
      const newState: SyncState = {
        configId,
        localSnapshot: localSnapshots,
        remoteSnapshot: currentState?.remoteSnapshot || null,
        status: 'synced',
        lastCheckedAt: Date.now(),
        pendingChanges: {
          local: [],
          remote: [],
          conflicts: [],
        },
      };

      await syncStorage.saveSyncState(newState);
      setSyncStates(prev => new Map(prev).set(configId, newState));

    } catch (err) {
      console.error(`Sync failed for config ${configId}:`, err);
      await syncStorage.updateSyncStatus(configId, 'error', err instanceof Error ? err.message : 'Sync failed');
      throw err;
    }
  }, [isPeerReady, getDataChannelForPeer, scanFolder]);

  /**
   * Delete sync configuration
   */
  const deleteSync = useCallback(async (configId: string): Promise<void> => {
    try {
      // Clear interval if exists
      const intervalId = syncIntervalRef.current.get(configId);
      if (intervalId) {
        clearInterval(intervalId);
        syncIntervalRef.current.delete(configId);
      }

      await syncStorage.deleteSyncConfig(configId);
      await loadSyncConfigs();
    } catch (err) {
      console.error(`Failed to delete sync ${configId}:`, err);
      setError(err instanceof Error ? err.message : 'Failed to delete sync');
    }
  }, [loadSyncConfigs]);

  /**
   * Get sync state for a config
   */
  const getSyncState = useCallback((configId: string): SyncState | null => {
    return syncStates.get(configId) || null;
  }, [syncStates]);

  /**
   * Check sync status for all configs
   */
  const checkAllSyncs = useCallback(async (): Promise<void> => {
    for (const config of syncConfigs) {
      if (!config.isActive) continue;

      try {
        // Scan folder to detect changes
        await scanFolder(config.id);
      } catch (err) {
        console.error(`Failed to check sync ${config.id}:`, err);
      }
    }
  }, [syncConfigs, scanFolder]);

  // Load sync configs on mount
  useEffect(() => {
    loadSyncConfigs();
  }, [loadSyncConfigs]);

  // Auto-check syncs periodically (every 60 seconds)
  useEffect(() => {
    if (syncConfigs.length === 0) return;

    const interval = setInterval(() => {
      checkAllSyncs();
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, [syncConfigs, checkAllSyncs]);

  return {
    syncConfigs,
    syncStates: Array.from(syncStates.values()),
    isLoading,
    error,
    createSync,
    performSync,
    deleteSync,
    scanFolder,
    getSyncState,
    checkAllSyncs,
    browserCaps,
  };
}

