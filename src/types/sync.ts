/**
 * Folder Sync Types
 * Supports cross-browser folder synchronization
 */

export type SyncDirection = "bidirectional" | "upload-only" | "download-only";
export type SyncStatus =
  | "synced"
  | "out-of-sync"
  | "syncing"
  | "error"
  | "conflict"
  | "offline";
export type ConflictResolution =
  | "last-write-wins"
  | "manual"
  | "local-wins"
  | "remote-wins";

/**
 * Sync configuration - defines a folder sync relationship
 */
export interface SyncConfig {
  id: string; // Unique sync ID
  localFolderHandle: FileSystemDirectoryHandle | null; // File System Access API handle (Chrome/Edge)
  localFolderPath: string; // Fallback path string (for Firefox/mobile)
  localFolderName: string; // Display name
  peerId: string; // Target peer device ID
  peerName: string; // Display name for peer
  sessionId: string; // Session ID for connection
  direction: SyncDirection;
  createdAt: number;
  lastSyncedAt: number | null;
  isActive: boolean;
  conflictResolution: ConflictResolution;
  // For mobile/Firefox: store file list instead of folder handle
  trackedFiles?: FileList | null; // Fallback for browsers without File System Access API
}

/**
 * File snapshot - represents a file at a point in time
 */
export interface FileSnapshot {
  path: string; // Relative path from sync root
  name: string;
  size: number;
  lastModified: number;
  hash: string; // MD5 or SHA-256 hash
  syncedAt: number;
  configId: string; // Which sync config this belongs to
}

/**
 * Sync state - current status of a sync
 */
export interface SyncState {
  configId: string;
  localSnapshot: FileSnapshot[];
  remoteSnapshot: FileSnapshot[] | null;
  status: SyncStatus;
  lastCheckedAt: number;
  pendingChanges: {
    local: FileSnapshot[]; // Files changed locally
    remote: FileSnapshot[]; // Files changed remotely
    conflicts: ConflictFile[]; // Files changed on both sides
  };
  error?: string;
}

/**
 * Conflict file - file changed on both sides
 */
export interface ConflictFile {
  path: string;
  local: FileSnapshot;
  remote: FileSnapshot;
  resolution?: "local" | "remote" | "both" | "manual";
}

/**
 * Sync message types for WebRTC communication
 */
export type SyncMessageType =
  | "sync-request" // Request sync with peer
  | "sync-metadata" // Exchange file metadata
  | "sync-file" // Transfer file
  | "sync-complete" // Sync finished
  | "sync-conflict" // Conflict detected
  | "sync-error"; // Error occurred

export interface SyncMessage {
  type: SyncMessageType;
  syncId: string;
  configId: string;
  data?: unknown;
}

/**
 * File change detection result
 */
export interface FileChange {
  type: "created" | "modified" | "deleted";
  snapshot: FileSnapshot;
  previousSnapshot?: FileSnapshot;
}

/**
 * Browser capabilities detection
 */
export interface BrowserCapabilities {
  hasFileSystemAccessAPI: boolean;
  hasIndexedDB: boolean;
  hasWebWorkers: boolean;
  isMobile: boolean;
}

/**
 * Sync progress - real-time sync progress tracking
 */
export interface SyncProgress {
  configId: string;
  phase: "scanning" | "comparing" | "transferring" | "finalizing";
  currentFile: string | null;
  filesProcessed: number;
  totalFiles: number;
  bytesTransferred: number;
  totalBytes: number;
  speed: number; // bytes per second
  eta: number; // seconds
}

/**
 * Conflict resolution action
 */
export interface ConflictResolutionAction {
  path: string;
  action: "local" | "remote" | "both" | "manual";
}

/**
 * Sync history entry
 */
export interface SyncHistoryEntry {
  configId: string;
  timestamp: number;
  duration: number;
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  bytesTransferred: number;
  status: "success" | "error" | "cancelled";
  error?: string;
}

/**
 * Sync diff - comparison between local and remote snapshots
 */
export interface SyncDiff {
  localOnly: FileSnapshot[]; // Files only on local
  remoteOnly: FileSnapshot[]; // Files only on remote
  modified: FileSnapshot[]; // Files changed on both
  unchanged: FileSnapshot[]; // Files identical
  conflicts: ConflictFile[]; // Files with conflicts
}

/**
 * Sync plan - what actions to take for sync
 */
export interface SyncPlan {
  upload: FileSnapshot[];
  download: FileSnapshot[];
  delete: FileSnapshot[];
  conflicts: ConflictFile[];
}
