/**
 * IndexedDB Storage Service for Folder Sync
 * Handles persistence of sync configs, file snapshots, and sync states
 */

import type { SyncConfig, FileSnapshot, SyncState } from '@/types/sync';

const DB_NAME = 'butterfly-drop-sync';
const DB_VERSION = 1;

const STORES = {
  SYNC_CONFIGS: 'syncConfigs',
  FILE_SNAPSHOTS: 'fileSnapshots',
  SYNC_STATES: 'syncStates',
} as const;

interface DBSchema {
  [STORES.SYNC_CONFIGS]: SyncConfig;
  [STORES.FILE_SNAPSHOTS]: FileSnapshot;
  [STORES.SYNC_STATES]: SyncState;
}

class SyncStorageService {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize IndexedDB database
   */
  private async init(): Promise<void> {
    if (this.db) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      // Check if IndexedDB is available
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this browser'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error}`));
        this.initPromise = null;
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create sync configs store
        if (!db.objectStoreNames.contains(STORES.SYNC_CONFIGS)) {
          const configStore = db.createObjectStore(STORES.SYNC_CONFIGS, {
            keyPath: 'id',
          });
          configStore.createIndex('peerId', 'peerId', { unique: false });
          configStore.createIndex('sessionId', 'sessionId', { unique: false });
        }

        // Create file snapshots store
        if (!db.objectStoreNames.contains(STORES.FILE_SNAPSHOTS)) {
          const snapshotStore = db.createObjectStore(STORES.FILE_SNAPSHOTS, {
            keyPath: ['configId', 'path'],
          });
          snapshotStore.createIndex('configId', 'configId', { unique: false });
          snapshotStore.createIndex('lastModified', 'lastModified', { unique: false });
        }

        // Create sync states store
        if (!db.objectStoreNames.contains(STORES.SYNC_STATES)) {
          db.createObjectStore(STORES.SYNC_STATES, {
            keyPath: 'configId',
          });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInit(): Promise<void> {
    if (!this.db) {
      await this.init();
    }
  }

  // ==================== Sync Configs ====================

  async saveSyncConfig(config: SyncConfig): Promise<void> {
    await this.ensureInit();
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORES.SYNC_CONFIGS], 'readwrite');
      const store = transaction.objectStore(STORES.SYNC_CONFIGS);
      
      // Convert FileSystemDirectoryHandle to null for storage (can't serialize)
      const configToStore: SyncConfig = {
        ...config,
        localFolderHandle: null, // Don't store handle, will need to re-request
      };

      const request = store.put(configToStore);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save sync config: ${request.error}`));
    });
  }

  async getSyncConfig(id: string): Promise<SyncConfig | null> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORES.SYNC_CONFIGS], 'readonly');
      const store = transaction.objectStore(STORES.SYNC_CONFIGS);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get sync config: ${request.error}`));
      };
    });
  }

  async getAllSyncConfigs(): Promise<SyncConfig[]> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORES.SYNC_CONFIGS], 'readonly');
      const store = transaction.objectStore(STORES.SYNC_CONFIGS);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get sync configs: ${request.error}`));
      };
    });
  }

  async deleteSyncConfig(id: string): Promise<void> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(
        [STORES.SYNC_CONFIGS, STORES.FILE_SNAPSHOTS, STORES.SYNC_STATES],
        'readwrite'
      );
      
      // Delete config
      const configStore = transaction.objectStore(STORES.SYNC_CONFIGS);
      configStore.delete(id);

      // Delete all snapshots for this config
      const snapshotStore = transaction.objectStore(STORES.FILE_SNAPSHOTS);
      const index = snapshotStore.index('configId');
      const snapshotRequest = index.openKeyCursor(IDBKeyRange.only(id));
      
      snapshotRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          snapshotStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      // Delete sync state
      const stateStore = transaction.objectStore(STORES.SYNC_STATES);
      stateStore.delete(id);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error(`Failed to delete sync config: ${transaction.error}`));
    });
  }

  // ==================== File Snapshots ====================

  async saveFileSnapshot(snapshot: FileSnapshot): Promise<void> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORES.FILE_SNAPSHOTS], 'readwrite');
      const store = transaction.objectStore(STORES.FILE_SNAPSHOTS);
      const request = store.put(snapshot);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save file snapshot: ${request.error}`));
    });
  }

  async getFileSnapshot(configId: string, path: string): Promise<FileSnapshot | null> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORES.FILE_SNAPSHOTS], 'readonly');
      const store = transaction.objectStore(STORES.FILE_SNAPSHOTS);
      const request = store.get([configId, path]);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get file snapshot: ${request.error}`));
      };
    });
  }

  async getAllSnapshots(configId: string): Promise<FileSnapshot[]> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORES.FILE_SNAPSHOTS], 'readonly');
      const store = transaction.objectStore(STORES.FILE_SNAPSHOTS);
      const index = store.index('configId');
      const request = index.getAll(configId);

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get file snapshots: ${request.error}`));
      };
    });
  }

  async deleteSnapshots(configId: string): Promise<void> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORES.FILE_SNAPSHOTS], 'readwrite');
      const store = transaction.objectStore(STORES.FILE_SNAPSHOTS);
      const index = store.index('configId');
      const request = index.openKeyCursor(IDBKeyRange.only(configId));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => {
        reject(new Error(`Failed to delete file snapshots: ${request.error}`));
      };
    });
  }

  // ==================== Sync States ====================

  async saveSyncState(state: SyncState): Promise<void> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORES.SYNC_STATES], 'readwrite');
      const store = transaction.objectStore(STORES.SYNC_STATES);
      const request = store.put(state);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save sync state: ${request.error}`));
    });
  }

  async getSyncState(configId: string): Promise<SyncState | null> {
    await this.ensureInit();

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([STORES.SYNC_STATES], 'readonly');
      const store = transaction.objectStore(STORES.SYNC_STATES);
      const request = store.get(configId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get sync state: ${request.error}`));
      };
    });
  }

  async updateSyncStatus(configId: string, status: SyncState['status'], error?: string): Promise<void> {
    const state = await this.getSyncState(configId);
    if (state) {
      state.status = status;
      state.lastCheckedAt = Date.now();
      if (error) {
        state.error = error;
      }
      await this.saveSyncState(state);
    }
  }
}

// Export singleton instance
export const syncStorage = new SyncStorageService();

