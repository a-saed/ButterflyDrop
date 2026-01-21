# Folder Sync Feature - Brainstorming & Architecture

## 🎯 Feature Overview

Enable persistent, bidirectional folder synchronization between devices. Users can set up folder syncs that persist across app sessions, automatically detect changes, and sync files when devices are connected.

---

## 🏗️ Architecture Overview

### Core Components

1. **Sync Configuration Storage** (IndexedDB/localStorage)
   - Store sync pairs (local folder ↔ peer device)
   - Track sync metadata (last sync time, file hashes, etc.)
   - Persist across app restarts

2. **File Change Detection**
   - Periodic scanning of synced folders
   - Hash-based change detection (MD5/SHA-256)
   - File System Access API for folder watching (where supported)

3. **Sync Engine**
   - Compare local vs remote file states
   - Determine sync direction (upload/download/bidirectional)
   - Handle conflicts intelligently

4. **Sync UI**
   - List of active syncs
   - Sync status indicators
   - Manual sync triggers
   - Conflict resolution UI

---

## 📊 Data Models

### Sync Configuration

```typescript
interface SyncConfig {
  id: string; // Unique sync ID
  localFolderHandle: FileSystemDirectoryHandle | null; // File System Access API handle
  localFolderPath: string; // Fallback path string
  peerId: string; // Target peer device ID
  peerName: string; // Display name for peer
  sessionId: string; // Session ID for connection
  direction: 'bidirectional' | 'upload-only' | 'download-only';
  createdAt: number;
  lastSyncedAt: number | null;
  isActive: boolean;
  conflictResolution: 'last-write-wins' | 'manual' | 'local-wins' | 'remote-wins';
}

interface FileSnapshot {
  path: string; // Relative path from sync root
  name: string;
  size: number;
  lastModified: number;
  hash: string; // MD5 or SHA-256 hash
  syncedAt: number;
}

interface SyncState {
  configId: string;
  localSnapshot: FileSnapshot[];
  remoteSnapshot: FileSnapshot[] | null;
  status: 'synced' | 'out-of-sync' | 'syncing' | 'error' | 'conflict';
  lastCheckedAt: number;
  pendingChanges: {
    local: FileSnapshot[]; // Files changed locally
    remote: FileSnapshot[]; // Files changed remotely
    conflicts: ConflictFile[]; // Files changed on both sides
  };
}

interface ConflictFile {
  path: string;
  local: FileSnapshot;
  remote: FileSnapshot;
  resolution?: 'local' | 'remote' | 'both' | 'manual';
}
```

---

## 💾 Storage Strategy

### IndexedDB Schema

**Store: `syncConfigs`**
- Key: `syncConfig.id`
- Value: `SyncConfig`

**Store: `fileSnapshots`**
- Key: `${syncConfigId}:${filePath}`
- Value: `FileSnapshot`
- Index: `syncConfigId`, `lastModified`

**Store: `syncStates`**
- Key: `syncConfigId`
- Value: `SyncState`

### Storage Service API

```typescript
// src/services/syncStorage.ts

class SyncStorageService {
  // Sync configurations
  async saveSyncConfig(config: SyncConfig): Promise<void>
  async getSyncConfig(id: string): Promise<SyncConfig | null>
  async getAllSyncConfigs(): Promise<SyncConfig[]>
  async deleteSyncConfig(id: string): Promise<void>
  
  // File snapshots
  async saveFileSnapshot(configId: string, snapshot: FileSnapshot): Promise<void>
  async getFileSnapshot(configId: string, path: string): Promise<FileSnapshot | null>
  async getAllSnapshots(configId: string): Promise<FileSnapshot[]>
  async deleteSnapshots(configId: string): Promise<void>
  
  // Sync states
  async saveSyncState(state: SyncState): Promise<void>
  async getSyncState(configId: string): Promise<SyncState | null>
  async updateSyncStatus(configId: string, status: SyncState['status']): Promise<void>
}
```

---

## 🔍 Change Detection Strategy

### Approach 1: Periodic Scanning (MVP)
- **Pros**: Works everywhere, simple
- **Cons**: Not real-time, battery impact on mobile
- **Implementation**: 
  - Scan folders every 30-60 seconds when app is active
  - Compare file hashes/metadata with stored snapshots
  - Use Web Workers for background scanning

### Approach 2: File System Access API (Future)
- **Pros**: Real-time change detection, efficient
- **Cons**: Chrome/Edge only, requires user permission
- **Implementation**:
  - Use `FileSystemDirectoryHandle.watch()` when available
  - Fallback to periodic scanning

### Change Detection Algorithm

```typescript
async function detectChanges(
  config: SyncConfig,
  previousSnapshots: FileSnapshot[]
): Promise<FileSnapshot[]> {
  const currentSnapshots: FileSnapshot[] = [];
  
  // Recursively scan folder
  await scanFolder(config.localFolderHandle, '', currentSnapshots);
  
  // Compare with previous snapshots
  const changes: FileSnapshot[] = [];
  const snapshotMap = new Map(previousSnapshots.map(s => [s.path, s]));
  
  for (const current of currentSnapshots) {
    const previous = snapshotMap.get(current.path);
    
    if (!previous) {
      // New file
      changes.push({ ...current, syncedAt: 0 });
    } else if (
      previous.hash !== current.hash ||
      previous.lastModified !== current.lastModified ||
      previous.size !== current.size
    ) {
      // Modified file
      changes.push(current);
    }
    
    snapshotMap.delete(current.path);
  }
  
  // Remaining in snapshotMap are deleted files
  for (const deleted of snapshotMap.values()) {
    changes.push({ ...deleted, size: 0, hash: '' }); // Mark as deleted
  }
  
  return changes;
}
```

---

## 🔄 Sync Protocol

### Sync Message Types

```typescript
type SyncMessageType = 
  | 'sync-request'      // Request sync with peer
  | 'sync-metadata'     // Exchange file metadata
  | 'sync-file'         // Transfer file
  | 'sync-complete'     // Sync finished
  | 'sync-conflict'     // Conflict detected
  | 'sync-error';       // Error occurred

interface SyncMessage {
  type: SyncMessageType;
  syncId: string;
  configId: string;
  data?: unknown;
}
```

### Sync Flow

1. **Initial Sync Setup**
   ```
   Device A → Device B: sync-request { configId, localSnapshot }
   Device B → Device A: sync-metadata { remoteSnapshot }
   Both devices compare snapshots
   ```

2. **Bidirectional Sync**
   ```
   For each file difference:
     - If only local changed → upload to remote
     - If only remote changed → download from remote
     - If both changed → conflict resolution
   ```

3. **Incremental Sync**
   ```
   Device A detects changes → Device A → Device B: sync-metadata { changes }
   Device B compares → Device B → Device A: sync-metadata { changes }
   Both sync differences
   ```

### Conflict Resolution Strategies

1. **Last-Write-Wins** (Default)
   - Compare `lastModified` timestamps
   - Keep newer version, discard older

2. **Manual Resolution** (User Choice)
   - Show conflict UI
   - User chooses: keep local, keep remote, keep both (rename)

3. **Local-Wins / Remote-Wins**
   - User preference per sync config

---

## 🎨 UI/UX Design

### Main Sync View

```
┌─────────────────────────────────────────┐
│  📁 Synced Folders                      │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ 📂 Documents                     │ │
│  │ 👤 Syncing with: John's MacBook  │ │
│  │ 🟢 In Sync (last: 2 min ago)     │ │
│  │ [⚙️] [🔄 Sync Now] [❌]          │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ 📂 Photos                         │ │
│  │ 👤 Syncing with: iPhone 13        │ │
│  │ 🟡 Out of Sync (3 files changed)  │ │
│  │ [⚙️] [🔄 Sync Now] [❌]          │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ 📂 Work Files                     │ │
│  │ 👤 Syncing with: Work Laptop       │ │
│  │ 🔴 Conflict (2 files)             │ │
│  │ [⚙️] [🔍 Resolve] [❌]            │ │
│  └───────────────────────────────────┘ │
│                                         │
│  [+ Add Folder Sync]                    │
│                                         │
└─────────────────────────────────────────┘
```

### Sync Status Indicators

- 🟢 **In Sync**: All files match, last sync < 5 min ago
- 🟡 **Out of Sync**: Changes detected, needs sync
- 🔴 **Conflict**: Files changed on both sides
- 🔵 **Syncing**: Currently transferring files
- ⚪ **Offline**: Peer not connected
- ⚫ **Error**: Sync failed

### Add Sync Flow

1. **Select Folder**
   - Use File System Access API `showDirectoryPicker()`
   - Fallback: Manual path entry (limited functionality)

2. **Select Peer**
   - Show list of available peers in current session
   - Or enter session ID to connect to peer

3. **Configure Sync**
   - Direction: Bidirectional / Upload Only / Download Only
   - Conflict resolution strategy
   - Auto-sync interval

4. **Initial Sync**
   - Show progress
   - Transfer all files initially

### Conflict Resolution UI

```
┌─────────────────────────────────────────┐
│  ⚠️ Sync Conflicts                      │
├─────────────────────────────────────────┤
│                                         │
│  File: document.pdf                     │
│  ┌───────────────────────────────────┐ │
│  │ Local (Modified: 2 hours ago)     │ │
│  │ Size: 2.3 MB                      │ │
│  │ [Preview] [Keep Local]             │ │
│  └───────────────────────────────────┘ │
│  ┌───────────────────────────────────┐ │
│  │ Remote (Modified: 1 hour ago)     │ │
│  │ Size: 2.1 MB                      │ │
│  │ [Preview] [Keep Remote]            │ │
│  └───────────────────────────────────┘ │
│                                         │
│  [Keep Both (Rename)]                   │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🚀 Implementation Phases

### Phase 1: Foundation (MVP)
- [ ] IndexedDB storage service
- [ ] Sync configuration CRUD
- [ ] Basic file scanning
- [ ] Hash calculation (MD5/SHA-256)
- [ ] Sync state management

### Phase 2: Core Sync
- [ ] Sync protocol messages
- [ ] Metadata exchange
- [ ] File transfer integration
- [ ] Basic conflict detection
- [ ] Last-write-wins resolution

### Phase 3: UI/UX
- [ ] Sync list view
- [ ] Add sync flow
- [ ] Status indicators
- [ ] Manual sync trigger
- [ ] Basic conflict UI

### Phase 4: Advanced Features
- [ ] Periodic auto-sync
- [ ] File System Access API integration
- [ ] Advanced conflict resolution
- [ ] Sync history/logs
- [ ] Bandwidth optimization (delta sync)

---

## 🔧 Technical Considerations

### Browser Limitations

1. **File System Access**
   - Chrome/Edge: Full support via File System Access API
   - Firefox/Safari: Limited (manual path entry only)
   - Mobile: Very limited

2. **Folder Watching**
   - No native folder watching in browsers
   - Must use periodic scanning
   - File System Access API `watch()` is experimental

3. **Storage Limits**
   - IndexedDB: ~50% of disk space (varies by browser)
   - localStorage: 5-10MB limit
   - Use IndexedDB for file snapshots

### Performance Optimizations

1. **Incremental Scanning**
   - Only scan changed directories
   - Cache directory structure

2. **Hash Calculation**
   - Use Web Workers for parallel hashing
   - Cache hashes in IndexedDB
   - Only hash files that changed (size/modified time)

3. **Delta Sync**
   - Only transfer changed chunks of files
   - Use rsync-like algorithm for large files

### Security & Privacy

1. **Permissions**
   - Request folder access explicitly
   - Store handles securely (encrypted if possible)

2. **Data Validation**
   - Validate all file paths
   - Sanitize file names
   - Check file sizes before transfer

3. **Sync Scope**
   - Only sync explicitly selected folders
   - Never sync system folders or sensitive locations

---

## 📝 File Structure

```
src/
├── services/
│   ├── syncStorage.ts          # IndexedDB storage service
│   └── syncEngine.ts           # Core sync logic
├── hooks/
│   ├── useFolderSync.ts        # Main sync hook
│   ├── useFileWatcher.ts       # File change detection
│   └── useSyncState.ts         # Sync state management
├── components/
│   ├── sync/
│   │   ├── SyncList.tsx        # List of active syncs
│   │   ├── SyncItem.tsx        # Individual sync card
│   │   ├── AddSyncDialog.tsx   # Add new sync flow
│   │   ├── ConflictResolver.tsx # Conflict resolution UI
│   │   └── SyncProgress.tsx    # Sync progress indicator
├── types/
│   └── sync.ts                 # Sync type definitions
└── lib/
    ├── fileHashing.ts          # File hash utilities
    └── folderScanner.ts        # Folder scanning utilities
```

---

## 🎯 Success Metrics

- Users can set up folder syncs that persist across sessions
- Changes are detected within 1 minute
- Sync completes successfully 95%+ of the time
- Conflict resolution is intuitive
- UI clearly shows sync status

---

## ❓ Open Questions

1. **How to handle large folders?**
   - Limit folder size?
   - Progressive sync (sync most recent files first)?
   - User warning for folders > 1GB?

2. **What about deleted files?**
   - Sync deletions? (risky)
   - Archive deleted files?
   - User preference?

3. **Mobile support?**
   - Very limited folder access on mobile
   - Focus on desktop initially?
   - Use photo library API for mobile?

4. **Multiple peers syncing same folder?**
   - Allow multiple sync configs for same folder?
   - Merge changes from multiple peers?
   - Conflict resolution becomes complex

5. **Bandwidth management?**
   - Pause sync when on metered connection?
   - Limit sync speed?
   - Schedule syncs for off-peak hours?

---

## 🚦 Recommended Approach

### Start Simple (MVP)

1. **Manual Sync Only**
   - No auto-sync initially
   - User clicks "Sync Now" button
   - Simpler, more predictable

2. **Single Peer Per Folder**
   - One sync config = one folder ↔ one peer
   - Avoid multi-peer complexity

3. **Last-Write-Wins Only**
   - Simple conflict resolution
   - Add manual resolution later

4. **File System Access API Only**
   - Chrome/Edge focus initially
   - Better UX, real folder access
   - Add fallback later

5. **Full Folder Sync**
   - Sync entire folder structure
   - No selective file syncing initially

This approach gives us a working MVP that can be enhanced incrementally.

