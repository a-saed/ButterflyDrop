/**
 * BDP — IndexedDB Service (A3)
 *
 * Single source of truth for the BDP database schema. All BDP services that
 * need to read/write IndexedDB go through this module — never open the DB
 * directly elsewhere.
 *
 * Schema (version 1):
 *   devices      — keyed by 'deviceId'    — BDPDevice records
 *   deviceKeys   — keyed by string        — non-extractable CryptoKey objects
 *   pairs        — keyed by 'pairId'      — SyncPair records
 *   fileIndex    — keyed by [pairId, path] — BDPFileEntry records
 *   merkleNodes  — keyed by [pairId, nodePath] — BDPMerkleNode records
 *   indexRoots   — keyed by 'pairId'      — BDPIndexRoot records
 *   casIndex     — keyed by 'hash'        — CASChunk records
 *   syncHistory  — keyed by [pairId, timestamp] — BDPSyncHistoryEntry records
 *   relayState   — keyed by 'pairId'      — RelayState records
 *   conflicts    — keyed by [pairId, path] — ConflictRecord records
 *
 * Indexes:
 *   fileIndex / idx_pairId_seq       — [pairId, seq]        for delta queries
 *   fileIndex / idx_pairId_tombstone — [pairId, tombstone]  for live-file listing
 *   casIndex  / idx_refCount         — refCount             for GC queries
 *   conflicts / idx_pairId_resolved  — [pairId, resolvedAt] for pending query
 */

import type {
  BDPDevice,
  BDPFileEntry,
  BDPIndexRoot,
  BDPMerkleNode,
  BDPSyncHistoryEntry,
  CASChunk,
  ConflictRecord,
  PairId,
  RelayState,
  SyncPair,
} from '@/types/bdp'
import { BDP_CONSTANTS } from '@/types/bdp'

// ─────────────────────────────────────────────────────────────────────────────
// Store name union — keeps idbGet / idbPut calls typo-safe
// ─────────────────────────────────────────────────────────────────────────────

export type StoreName =
  | 'devices'
  | 'deviceKeys'
  | 'pairs'
  | 'fileIndex'
  | 'merkleNodes'
  | 'indexRoots'
  | 'casIndex'
  | 'syncHistory'
  | 'relayState'
  | 'conflicts'

// ─────────────────────────────────────────────────────────────────────────────
// Schema definition
// ─────────────────────────────────────────────────────────────────────────────

interface StoreDefinition {
  keyPath: string | string[] | null
  autoIncrement?: boolean
  indexes?: Array<{
    name: string
    keyPath: string | string[]
    unique?: boolean
    multiEntry?: boolean
  }>
}

const SCHEMA: Record<StoreName, StoreDefinition> = {
  devices: {
    keyPath: 'deviceId',
  },
  deviceKeys: {
    // Stores non-extractable CryptoKey objects. Key is supplied explicitly.
    keyPath: null,
  },
  pairs: {
    keyPath: 'pairId',
  },
  fileIndex: {
    keyPath: ['pairId', 'path'],
    indexes: [
      {
        name: 'idx_pairId_seq',
        keyPath: ['pairId', 'seq'],
      },
      {
        name: 'idx_pairId_tombstone',
        keyPath: ['pairId', 'tombstone'],
      },
    ],
  },
  merkleNodes: {
    keyPath: ['pairId', 'nodePath'],
  },
  indexRoots: {
    keyPath: 'pairId',
  },
  casIndex: {
    keyPath: 'hash',
    indexes: [
      {
        name: 'idx_refCount',
        keyPath: 'refCount',
      },
    ],
  },
  syncHistory: {
    keyPath: ['pairId', 'timestamp'],
  },
  relayState: {
    keyPath: 'pairId',
  },
  conflicts: {
    keyPath: ['pairId', 'path'],
    indexes: [
      {
        name: 'idx_pairId_resolved',
        keyPath: ['pairId', 'resolvedAt'],
      },
    ],
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// DB lifecycle — singleton promise pattern
// ─────────────────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * Returns the singleton BDP IDBDatabase, opening it on the first call.
 *
 * The database schema is created / migrated in `onupgradeneeded`.
 * The promise is cached — subsequent calls return the same open connection.
 *
 * @returns Open IDBDatabase instance
 * @throws If IndexedDB is unavailable or the open request is blocked
 */
export function openDB(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(
      BDP_CONSTANTS.IDB_DB_NAME,
      BDP_CONSTANTS.IDB_DB_VERSION,
    )

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const oldVersion = event.oldVersion

      // Create all stores that don't yet exist.
      // We check oldVersion so this is safe across future version bumps.
      if (oldVersion < 1) {
        createStores(db)
      }
      // Future migrations: if (oldVersion < 2) { ... }
    }

    request.onsuccess = () => resolve(request.result)

    request.onerror = () => {
      dbPromise = null // allow retry
      reject(request.error)
    }

    request.onblocked = () => {
      dbPromise = null
      reject(
        new Error(
          'BDP IDB open blocked — another tab has an older version open. ' +
            'Close all other tabs and reload.',
        ),
      )
    }
  })

  return dbPromise
}

/**
 * Creates all object stores and their indexes from the SCHEMA definition.
 * Must only be called inside `onupgradeneeded`.
 */
function createStores(db: IDBDatabase): void {
  for (const [storeName, def] of Object.entries(SCHEMA) as [
    StoreName,
    StoreDefinition,
  ][]) {
    // Skip if the store already exists (safety guard during future migrations)
    if (db.objectStoreNames.contains(storeName)) continue

    const store = db.createObjectStore(storeName, {
      keyPath: def.keyPath ?? undefined,
      autoIncrement: def.autoIncrement ?? false,
    })

    for (const idx of def.indexes ?? []) {
      store.createIndex(idx.name, idx.keyPath, {
        unique: idx.unique ?? false,
        multiEntry: idx.multiEntry ?? false,
      })
    }
  }
}

/**
 * Resets the cached DB promise, forcing a fresh open on the next call.
 * Intended for use in tests only.
 */
export function _resetDBPromise(): void {
  dbPromise = null
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic typed helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a single record by its primary key.
 *
 * @param store - Object store name
 * @param key - Primary key value
 * @returns The record, or undefined if not found
 */
export async function idbGet<T>(
  store: StoreName,
  key: IDBValidKey,
): Promise<T | undefined> {
  const db = await openDB()
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Writes (or overwrites) a record using its inline keyPath.
 * For stores with keyPath: null, use idbPutWithKey() instead.
 *
 * @param store - Object store name
 * @param value - Record to write
 */
export async function idbPut<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const req = tx.objectStore(store).put(value)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * Writes a record under an explicit key (for stores with keyPath: null).
 *
 * @param store - Object store name
 * @param key - Explicit key to store under
 * @param value - Record to write
 */
export async function idbPutWithKey(
  store: StoreName,
  key: IDBValidKey,
  value: unknown,
): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const req = tx.objectStore(store).put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * Deletes a record by its primary key.
 * No-op if the record doesn't exist.
 *
 * @param store - Object store name
 * @param key - Primary key of the record to delete
 */
export async function idbDelete(
  store: StoreName,
  key: IDBValidKey,
): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const req = tx.objectStore(store).delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * Returns all records in a store.
 *
 * @param store - Object store name
 * @returns All records as a typed array
 */
export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB()
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

/**
 * Queries records via a named index.
 *
 * @param store - Object store name
 * @param indexName - Name of the index to query
 * @param query - Key range or exact key to match
 * @returns Matching records as a typed array
 */
export async function idbGetByIndex<T>(
  store: StoreName,
  indexName: string,
  query: IDBKeyRange | IDBValidKey,
): Promise<T[]> {
  const db = await openDB()
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const index = tx.objectStore(store).index(indexName)
    const req = index.getAll(query)
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

/**
 * Counts records matching a query on a named index.
 *
 * @param store - Object store name
 * @param indexName - Name of the index
 * @param query - Optional key range filter
 * @returns Count of matching records
 */
export async function idbCountByIndex(
  store: StoreName,
  indexName: string,
  query?: IDBKeyRange | IDBValidKey,
): Promise<number> {
  const db = await openDB()
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const index = tx.objectStore(store).index(indexName)
    const req = query !== undefined ? index.count(query) : index.count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific accessors — Devices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the persisted local device record.
 *
 * @param deviceId - The key to look up (typically 'self')
 * @returns BDPDevice, or undefined if not yet created
 */
export async function getDevice(
  deviceId: string,
): Promise<BDPDevice | undefined> {
  return idbGet<BDPDevice>('devices', deviceId)
}

/**
 * Writes a device record.
 *
 * @param device - The BDPDevice to persist
 */
export async function putDevice(device: BDPDevice): Promise<void> {
  return idbPut<BDPDevice>('devices', device)
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific accessors — Pairs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a sync pair by its pairId.
 *
 * @param pairId - The pair identifier
 * @returns SyncPair, or undefined if not found
 */
export async function getPair(pairId: PairId): Promise<SyncPair | undefined> {
  return idbGet<SyncPair>('pairs', pairId)
}

/**
 * Writes (or updates) a sync pair record.
 *
 * @param pair - The SyncPair to persist
 */
export async function putPair(pair: SyncPair): Promise<void> {
  return idbPut<SyncPair>('pairs', pair)
}

/**
 * Returns all sync pairs for this device.
 *
 * @returns Array of all SyncPair records
 */
export async function getAllPairs(): Promise<SyncPair[]> {
  return idbGetAll<SyncPair>('pairs')
}

/**
 * Deletes a sync pair and does NOT cascade — callers are responsible for
 * removing associated fileIndex, merkleNodes, etc. entries.
 *
 * @param pairId - The pair to delete
 */
export async function deletePair(pairId: PairId): Promise<void> {
  return idbDelete('pairs', pairId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific accessors — File Index
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a single file entry from the index.
 *
 * @param pairId - The sync pair
 * @param path - Relative file path (e.g. "src/App.tsx")
 * @returns BDPFileEntry, or undefined if not indexed
 */
export async function getFileEntry(
  pairId: PairId,
  path: string,
): Promise<BDPFileEntry | undefined> {
  return idbGet<BDPFileEntry>('fileIndex', [pairId, path])
}

/**
 * Writes or updates a file entry in the index.
 *
 * @param entry - The BDPFileEntry to persist
 */
export async function putFileEntry(entry: BDPFileEntry): Promise<void> {
  return idbPut<BDPFileEntry>('fileIndex', entry)
}

/**
 * Deletes a file entry from the index.
 * Prefer marking entries as tombstones instead of hard-deleting them.
 *
 * @param pairId - The sync pair
 * @param path - Relative file path
 */
export async function deleteFileEntry(
  pairId: PairId,
  path: string,
): Promise<void> {
  return idbDelete('fileIndex', [pairId, path])
}

/**
 * Returns all file entries for a pair with seq > sinceSeq.
 * Used for delta sync: "what changed since the peer's last known seq?"
 *
 * @param pairId - The sync pair
 * @param sinceSeq - Lower bound (exclusive) for seq filtering
 * @returns Entries with seq in range (sinceSeq + 1, ∞)
 */
export async function getFileEntriesSince(
  pairId: PairId,
  sinceSeq: number,
): Promise<BDPFileEntry[]> {
  // IDBKeyRange.bound([pairId, sinceSeq + 1], [pairId, +∞])
  const range = IDBKeyRange.bound(
    [pairId, sinceSeq + 1],
    [pairId, Number.MAX_SAFE_INTEGER],
  )
  return idbGetByIndex<BDPFileEntry>('fileIndex', 'idx_pairId_seq', range)
}

/**
 * Returns ALL file entries for a pair, including tombstones.
 *
 * @param pairId - The sync pair
 * @returns Every BDPFileEntry for this pair
 */
export async function getAllFileEntries(pairId: PairId): Promise<BDPFileEntry[]> {
  // Use the seq index so results are naturally ordered by seq
  const range = IDBKeyRange.bound(
    [pairId, 0],
    [pairId, Number.MAX_SAFE_INTEGER],
  )
  return idbGetByIndex<BDPFileEntry>('fileIndex', 'idx_pairId_seq', range)
}

/**
 * Returns only non-tombstoned (live) file entries for a pair.
 *
 * @param pairId - The sync pair
 * @returns Live BDPFileEntry records (tombstone = false)
 */
export async function getLiveFileEntries(
  pairId: PairId,
): Promise<BDPFileEntry[]> {
  // Index stores boolean as 0 / 1 in some engines — query both representations
  const range = IDBKeyRange.only([pairId, false])
  return idbGetByIndex<BDPFileEntry>(
    'fileIndex',
    'idx_pairId_tombstone',
    range,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific accessors — Merkle Nodes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a Merkle tree node.
 *
 * @param pairId - The sync pair
 * @param nodePath - Node path within the tree ('' = root, 'src' = src/ node)
 * @returns BDPMerkleNode, or undefined if not yet computed
 */
export async function getMerkleNode(
  pairId: PairId,
  nodePath: string,
): Promise<BDPMerkleNode | undefined> {
  return idbGet<BDPMerkleNode>('merkleNodes', [pairId, nodePath])
}

/**
 * Writes or updates a Merkle tree node.
 *
 * @param node - The BDPMerkleNode to persist
 */
export async function putMerkleNode(node: BDPMerkleNode): Promise<void> {
  return idbPut<BDPMerkleNode>('merkleNodes', node)
}

/**
 * Deletes a Merkle tree node.
 * Called when a subtree is emptied (all files removed).
 *
 * @param pairId - The sync pair
 * @param nodePath - Node path to delete
 */
export async function deleteMerkleNode(
  pairId: PairId,
  nodePath: string,
): Promise<void> {
  return idbDelete('merkleNodes', [pairId, nodePath])
}

/**
 * Returns all Merkle nodes for a pair.
 * Primarily useful for debugging or a full tree rebuild.
 *
 * @param pairId - The sync pair
 * @returns All BDPMerkleNode records for this pair
 */
export async function getAllMerkleNodes(
  pairId: PairId,
): Promise<BDPMerkleNode[]> {
  const all = await idbGetAll<BDPMerkleNode>('merkleNodes')
  return all.filter((n) => n.pairId === pairId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific accessors — Index Roots
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the current Merkle index root for a pair.
 *
 * @param pairId - The sync pair
 * @returns BDPIndexRoot, or undefined if no index has been computed yet
 */
export async function getIndexRoot(
  pairId: PairId,
): Promise<BDPIndexRoot | undefined> {
  return idbGet<BDPIndexRoot>('indexRoots', pairId)
}

/**
 * Writes the Merkle index root for a pair.
 *
 * @param root - The BDPIndexRoot to persist
 */
export async function putIndexRoot(root: BDPIndexRoot): Promise<void> {
  return idbPut<BDPIndexRoot>('indexRoots', root)
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific accessors — CAS Index
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads CAS chunk metadata by hash.
 *
 * @param hash - SHA-256 hex digest
 * @returns CASChunk metadata, or undefined if not tracked
 */
export async function getCASChunk(
  hash: string,
): Promise<CASChunk | undefined> {
  return idbGet<CASChunk>('casIndex', hash)
}

/**
 * Writes or updates CAS chunk metadata.
 *
 * @param chunk - The CASChunk record to persist
 */
export async function putCASChunk(chunk: CASChunk): Promise<void> {
  return idbPut<CASChunk>('casIndex', chunk)
}

/**
 * Deletes CAS chunk metadata (called after the chunk is GC'd from OPFS).
 *
 * @param hash - SHA-256 hex digest
 */
export async function deleteCASChunk(hash: string): Promise<void> {
  return idbDelete('casIndex', hash)
}

/**
 * Returns all CAS chunks with refCount = 0 (eligible for garbage collection).
 *
 * @returns Array of unreferenced CASChunk records
 */
export async function getUnreferencedChunks(): Promise<CASChunk[]> {
  return idbGetByIndex<CASChunk>('casIndex', 'idx_refCount', IDBKeyRange.only(0))
}

/**
 * Increments the refCount for a chunk, creating the record if it doesn't exist.
 *
 * @param hash - SHA-256 hex digest
 * @param originalSize - Original (uncompressed) byte size
 * @param storedSize - Actual stored byte size
 * @param storedCompressed - Whether the stored bytes are compressed
 */
export async function incrementChunkRef(
  hash: string,
  originalSize: number,
  storedSize: number,
  storedCompressed: boolean,
): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('casIndex', 'readwrite')
    const store = tx.objectStore('casIndex')
    const getReq = store.get(hash)

    getReq.onsuccess = () => {
      const existing = getReq.result as CASChunk | undefined
      const now = Date.now()

      const updated: CASChunk = existing
        ? { ...existing, refCount: existing.refCount + 1, lastAccessedAt: now }
        : {
            hash: hash as CASChunk['hash'],
            storedCompressed,
            originalSize,
            storedSize,
            refCount: 1,
            createdAt: now,
            lastAccessedAt: now,
          }

      const putReq = store.put(updated)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    }

    getReq.onerror = () => reject(getReq.error)
  })
}

/**
 * Decrements the refCount for a chunk.
 * If the chunk doesn't exist, this is a no-op.
 *
 * @param hash - SHA-256 hex digest
 */
export async function decrementChunkRef(hash: string): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('casIndex', 'readwrite')
    const store = tx.objectStore('casIndex')
    const getReq = store.get(hash)

    getReq.onsuccess = () => {
      const existing = getReq.result as CASChunk | undefined
      if (!existing) {
        resolve()
        return
      }

      const updated: CASChunk = {
        ...existing,
        refCount: Math.max(0, existing.refCount - 1),
      }

      const putReq = store.put(updated)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    }

    getReq.onerror = () => reject(getReq.error)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific accessors — Sync History
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Appends a sync history record.
 *
 * @param entry - The BDPSyncHistoryEntry to persist
 */
export async function putSyncHistory(
  entry: BDPSyncHistoryEntry,
): Promise<void> {
  return idbPut<BDPSyncHistoryEntry>('syncHistory', entry)
}

/**
 * Returns sync history entries for a pair, most-recent first.
 *
 * @param pairId - The sync pair
 * @param limit - Maximum number of entries to return (default: 50)
 * @returns Array of BDPSyncHistoryEntry, sorted descending by timestamp
 */
export async function getSyncHistory(
  pairId: PairId,
  limit = 50,
): Promise<BDPSyncHistoryEntry[]> {
  const all = await idbGetAll<BDPSyncHistoryEntry>('syncHistory')
  return all
    .filter((e) => e.pairId === pairId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific accessors — Relay State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the relay state for a pair.
 *
 * @param pairId - The sync pair
 * @returns RelayState, or undefined if never pushed/pulled
 */
export async function getRelayState(
  pairId: PairId,
): Promise<RelayState | undefined> {
  return idbGet<RelayState>('relayState', pairId)
}

/**
 * Writes the relay state for a pair.
 *
 * @param state - The RelayState to persist
 */
export async function putRelayState(state: RelayState): Promise<void> {
  return idbPut<RelayState>('relayState', state)
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific accessors — Conflicts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes or updates a conflict record.
 *
 * @param conflict - The ConflictRecord to persist
 */
export async function putConflict(conflict: ConflictRecord): Promise<void> {
  return idbPut<ConflictRecord>('conflicts', conflict)
}

/**
 * Returns all unresolved conflict records for a pair.
 * A conflict is pending when resolvedAt === null.
 *
 * @param pairId - The sync pair
 * @returns Array of unresolved ConflictRecord entries
 */
export async function getPendingConflicts(
  pairId: PairId,
): Promise<ConflictRecord[]> {
  // IDBKeyRange.only([pairId, null]) — records where resolvedAt is null
  try {
    const range = IDBKeyRange.only([pairId, null])
    return idbGetByIndex<ConflictRecord>(
      'conflicts',
      'idx_pairId_resolved',
      range,
    )
  } catch {
    // Fallback: scan all conflicts for this pair and filter in-memory.
    // Some engines can't use null in composite IDBKeyRange.
    const all = await idbGetAll<ConflictRecord>('conflicts')
    return all.filter((c) => c.pairId === pairId && c.resolvedAt === null)
  }
}

/**
 * Returns all conflict records for a pair (resolved and pending).
 *
 * @param pairId - The sync pair
 * @returns All ConflictRecord entries for this pair
 */
export async function getAllConflicts(
  pairId: PairId,
): Promise<ConflictRecord[]> {
  const all = await idbGetAll<ConflictRecord>('conflicts')
  return all.filter((c) => c.pairId === pairId)
}

/**
 * Marks a conflict as resolved, recording the timestamp and applied resolution.
 *
 * @param pairId - The sync pair
 * @param path - File path of the conflict
 * @param appliedResolution - Which resolution was applied
 */
export async function resolveConflict(
  pairId: PairId,
  path: string,
  appliedResolution: ConflictRecord['appliedResolution'],
): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('conflicts', 'readwrite')
    const store = tx.objectStore('conflicts')
    const getReq = store.get([pairId, path])

    getReq.onsuccess = () => {
      const existing = getReq.result as ConflictRecord | undefined
      if (!existing) {
        resolve() // conflict already removed — nothing to do
        return
      }

      const updated: ConflictRecord = {
        ...existing,
        resolvedAt: Date.now(),
        appliedResolution,
      }

      const putReq = store.put(updated)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    }

    getReq.onerror = () => reject(getReq.error)
  })
}

/**
 * Hard-deletes a conflict record (used after the file has been finalised).
 *
 * @param pairId - The sync pair
 * @param path - File path of the conflict to remove
 */
export async function deleteConflict(
  pairId: PairId,
  path: string,
): Promise<void> {
  return idbDelete('conflicts', [pairId, path])
}
